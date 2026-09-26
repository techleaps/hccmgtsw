import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { blankToNull } from '../lib/sanitize';
import DocumentAttachments from './DocumentAttachments';
import BulkImportModal from './BulkImportModal';

const AWARD_CATEGORIES = [
  { key: 'Construction', label: 'Construction / milestones' },
  { key: 'Roofing', label: 'Roofing' },
  { key: 'Variation', label: 'Variation' },
  { key: 'Infrastructure', label: 'Infrastructure' },
  { key: 'Deed of Assignment', label: 'Deed of Assignment' },
  { key: 'Sales Discount', label: 'Sales discount / commission' },
  { key: 'Land', label: 'Land / premium / compensation' },
  { key: 'General', label: 'General / other awards' },
];

const BLANK = {
  contractor_name: '',
  phone_number: '',
  address: '',
  description: '',
  contract_amount: '',
  amount_applied: '',
  amount_given: '',
  award_date: '',
  approval_date: '',
  house_numbers: '',
  property_type: '',
  portfolio: '',
  request_ref: '',
  reason: '',
  payment_note: '',
  progress: '',
  comments: '',
  status: 'active',
  remarks: '',
  estate_id: '',
  award_category: 'Construction',
};

const STATUS_OPTS = ['active', 'ongoing', 'completed', 'terminated'];

/** Flexible Excel headers across all estate sheets */
export const CONTRACT_FIELD_DEFS = [
  {
    key: 'description',
    label: 'Description',
    type: 'text',
    required: true,
    synonyms: ['description', 'particulars', 'details', 'work description', 'title'],
  },
  {
    key: 'contractor_name',
    label: 'Contractor / Beneficiary',
    type: 'text',
    synonyms: [
      'contractor', 'contractor name', 'beneficiary', 'applicant', 'applicant/beneficiary',
      'payee', 'name',
    ],
  },
  {
    key: 'contract_amount',
    label: 'Contract Amount / Total Amount',
    type: 'number',
    synonyms: [
      'contract amount', 'amount', 'total amount', 'sum', 'contract value',
    ],
  },
  {
    key: 'amount_applied',
    label: 'Amount Applied / Payment Applied for',
    type: 'number',
    synonyms: [
      'amount applied for', 'payment applied for', 'amount applied', 'payment applied',
      'amount requested', 'amount requested for',
    ],
  },
  {
    key: 'amount_given',
    label: 'Amount Approved / Payment made (₦)',
    type: 'number',
    synonyms: [
      'amount approved', 'amount given', 'approved amount', 'amount paid',
    ],
  },
  {
    key: 'award_date',
    label: 'Date of Contract / Date of Award',
    type: 'date',
    synonyms: [
      'date of contract', 'date of award', 'award date', 'contract date',
      'date applied', 'date of application', 'date application',
    ],
  },
  {
    key: 'approval_date',
    label: 'Date of Approval / Approval Date',
    type: 'date',
    synonyms: [
      'date of approval', 'approval date', 'date approved', 'approved date',
    ],
  },
  {
    key: 'request_ref',
    label: 'Request vide / Reference',
    type: 'text',
    synonyms: [
      'request vide', 'reference', 'ref', 'requested via', 'letter ref',
      'request', 'vide',
    ],
  },
  {
    key: 'portfolio',
    label: 'Portfolio / House / Units',
    type: 'text',
    synonyms: [
      'portforlio', 'portfolio', 'house numbers', 'house no', 'units', 'plots',
    ],
  },
  {
    key: 'property_type',
    label: 'Property type (if separate)',
    type: 'text',
    synonyms: ['property type', 'type', 'house type'],
  },
  {
    key: 'reason',
    label: 'Reason / Milestone note',
    type: 'text',
    synonyms: [
      'reason', 'payment made', 'milestone', 'milestones', 'payment note',
    ],
  },
  {
    key: 'payment_note',
    label: 'Payment note (text)',
    type: 'text',
    synonyms: ['payment note', 'payment status'],
  },
  {
    key: 'progress',
    label: 'Progress',
    type: 'text',
    synonyms: ['progress', 'status of work', 'work status'],
  },
  {
    key: 'comments',
    label: 'Comment',
    type: 'text',
    synonyms: ['comment', 'comments'],
  },
  {
    key: 'remarks',
    label: 'Remarks',
    type: 'text',
    synonyms: ['remarks', 'remark', 'notes'],
  },
  {
    key: 'phone_number',
    label: 'Phone',
    type: 'text',
    synonyms: ['phone', 'phone number', 'tel', 'mobile'],
  },
];

function transformContractRecord(r, category, estateId) {
  const description = String(r.description || '').trim() || 'Untitled award';
  let contractor = String(r.contractor_name || '').trim();
  if (!contractor) contractor = 'Unspecified';

  // amount_given is approved payment; contract_amount is full contract if present
  const amountGiven = Number(r.amount_given) || 0;
  const amountApplied = Number(r.amount_applied) || amountGiven;
  const contractAmount = Number(r.contract_amount) || amountApplied || amountGiven;

  // reason column sometimes holds milestone text; payment_note may be empty
  let reason = r.reason || null;
  let payment_note = r.payment_note || null;
  // If "reason" looked like a number-only field was mis-mapped, keep text
  if (reason && /^\d+(\.\d+)?$/.test(String(reason).replace(/,/g, ''))) {
    // likely a mis-map of amount into reason — ignore
    reason = null;
  }

  const portfolio = (r.portfolio || r.house_numbers || '').trim() || null;
  const progress = (r.progress || '').trim() || null;
  let status = 'active';
  if (progress) {
    const pl = progress.toLowerCase();
    if (pl.includes('complete')) status = 'completed';
    else if (pl.includes('ongoing') || pl.includes('progress')) status = 'ongoing';
  }

  return {
    description,
    contractor_name: contractor,
    contract_amount: contractAmount,
    amount_applied: amountApplied,
    amount_given: amountGiven || amountApplied,
    award_date: r.award_date || null,
    approval_date: r.approval_date || r.award_date || null,
    request_ref: (r.request_ref || '').trim() || null,
    portfolio,
    house_numbers: portfolio,
    property_type: (r.property_type || '').trim() || null,
    reason,
    payment_note: payment_note || reason,
    progress,
    comments: r.comments || null,
    remarks: r.remarks || null,
    phone_number: r.phone_number || null,
    award_category: category || r.award_category || 'General',
    estate_id: estateId || r.estate_id || null,
    status,
  };
}

export default function ContractAwardsTab() {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [estateFilter, setEstateFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importCategory, setImportCategory] = useState('Construction');
  const [importEstateId, setImportEstateId] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [eRes, rRes] = await Promise.all([
      supabase.from('estates').select('*').eq('is_deleted', false).order('name'),
      supabase.from('contract_awards').select('*, estates(name)').eq('is_deleted', false).order('approval_date', { ascending: false }),
    ]);
    setEstates(eRes.data || []);
    setRows(rRes.data || []);
    setSelected(new Set());
    setLoading(false);
  }

  const filtered = useMemo(() => rows.filter((r) => {
    if (estateFilter && r.estate_id !== estateFilter) return false;
    if (categoryFilter && (r.award_category || '') !== categoryFilter) return false;
    const hay = [
      r.contractor_name, r.phone_number, r.house_numbers, r.portfolio,
      r.description, r.request_ref, r.reason, r.progress, r.remarks,
    ].join(' ').toLowerCase();
    return hay.includes(search.toLowerCase());
  }), [rows, estateFilter, categoryFilter, search]);

  const totals = useMemo(() => ({
    count: filtered.length,
    contract: filtered.reduce((s, r) => s + Number(r.contract_amount || 0), 0),
    applied: filtered.reduce((s, r) => s + Number(r.amount_applied || 0), 0),
    given: filtered.reduce((s, r) => s + Number(r.amount_given || 0), 0),
  }), [filtered]);

  const byCategory = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const k = r.award_category || 'General';
      if (!map.has(k)) map.set(k, { name: k, count: 0, given: 0 });
      const rec = map.get(k);
      rec.count += 1;
      rec.given += Number(r.amount_given || 0);
    });
    return [...map.values()].sort((a, b) => b.given - a.given);
  }, [filtered]);

  const byContractor = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const k = r.contractor_name || 'Unspecified';
      if (!map.has(k)) map.set(k, { name: k, count: 0, given: 0 });
      const rec = map.get(k);
      rec.count += 1;
      rec.given += Number(r.amount_given || 0);
    });
    return [...map.values()].sort((a, b) => b.given - a.given).slice(0, 25);
  }, [filtered]);

  const awardDupes = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      const title = String(r.description || '').trim().toLowerCase();
      const amt = Number(r.amount_given || 0);
      if (!title || !(amt > 0)) return;
      const key = `${title}|${amt.toFixed(2)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return [...map.values()]
      .filter((list) => list.length > 1)
      .map((list) => ({
        title: list[0].description,
        amount: Number(list[0].amount_given || 0),
        list,
        contractors: [...new Set(list.map((x) => x.contractor_name))],
      }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [rows]);

  function openNew() {
    setEditing(null);
    setForm({
      ...BLANK,
      estate_id: estateFilter || '',
      award_category: categoryFilter || 'Construction',
    });
    setError('');
    setShowModal(true);
  }

  function openEdit(row) {
    setEditing(row);
    setForm({
      contractor_name: row.contractor_name || '',
      phone_number: row.phone_number || '',
      address: row.address || '',
      description: row.description || '',
      contract_amount: row.contract_amount ?? '',
      amount_applied: row.amount_applied ?? '',
      amount_given: row.amount_given ?? '',
      award_date: row.award_date ? String(row.award_date).slice(0, 10) : '',
      approval_date: row.approval_date ? String(row.approval_date).slice(0, 10) : '',
      house_numbers: row.house_numbers || row.portfolio || '',
      property_type: row.property_type || '',
      portfolio: row.portfolio || '',
      request_ref: row.request_ref || '',
      reason: row.reason || '',
      payment_note: row.payment_note || '',
      progress: row.progress || '',
      comments: row.comments || '',
      status: row.status || 'active',
      remarks: row.remarks || '',
      estate_id: row.estate_id || '',
      award_category: row.award_category || 'General',
    });
    setError('');
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!form.description.trim() && !form.contractor_name.trim()) {
      setError('Description or contractor is required.');
      return;
    }
    setSaving(true);
    const payload = blankToNull({
      ...form,
      contractor_name: form.contractor_name.trim() || 'Unspecified',
      description: form.description.trim() || form.contractor_name.trim(),
      contract_amount: Number(form.contract_amount) || 0,
      amount_applied: Number(form.amount_applied) || 0,
      amount_given: Number(form.amount_given) || 0,
      estate_id: form.estate_id || null,
      house_numbers: form.house_numbers || form.portfolio || null,
    }, ['award_date', 'approval_date']);

    if (editing) {
      const { error: err } = await supabase.from('contract_awards').update(payload).eq('id', editing.id);
      setSaving(false);
      if (err) { setError(err.message); return; }
    } else {
      const { error: err } = await supabase.from('contract_awards').insert({ ...payload, created_by: profile.id });
      setSaving(false);
      if (err) { setError(err.message); return; }
    }
    setShowModal(false);
    load();
  }

  async function handleDelete(row) {
    if (!confirm(`Soft-delete award: ${row.contractor_name}?`)) return;
    await supabase.from('contract_awards').update({ is_deleted: true }).eq('id', row.id);
    load();
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (filtered.length && filtered.every((r) => selected.has(r.id))) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  }

  async function handleDeleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Soft-delete ${ids.length} selected award(s)?`)) return;
    setBulkBusy(true);
    for (let i = 0; i < ids.length; i += 200) {
      await supabase.from('contract_awards').update({ is_deleted: true }).in('id', ids.slice(i, i + 200));
    }
    setBulkBusy(false);
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Award of Contract</h2>
          <p className="muted" style={{ margin: 0 }}>
            Contractor / contract register (who was awarded what). Approved <b>payments</b> for those contracts
            are recorded under <b>Approvals / Expenditure → Award of Contract</b>.
          </p>
        </div>
        <div className="flex wrap">
          <Link className="btn btn-outline" to="/construction">Construction Units</Link>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setImportCategory(categoryFilter || 'Construction');
              setImportEstateId(estateFilter || '');
              setShowImport(true);
            }}
          >
            Bulk Import Excel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={bulkBusy || selected.size === 0}
            onClick={handleDeleteSelected}
          >
            Delete selected ({selected.size})
          </button>
          <button type="button" className="btn btn-primary" onClick={openNew}>+ New Award</button>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="stat-card"><div className="value">{totals.count}</div><div className="label">Awards shown</div></div>
        <div className="stat-card"><div className="value">₦{totals.contract.toLocaleString()}</div><div className="label">Contract / total amt</div></div>
        <div className="stat-card"><div className="value">₦{totals.applied.toLocaleString()}</div><div className="label">Applied for</div></div>
        <div className="stat-card gold"><div className="value">₦{totals.given.toLocaleString()}</div><div className="label">Approved / paid</div></div>
      </div>

      {awardDupes.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #dc2626', background: '#fef2f2' }}>
          <h3 style={{ marginTop: 0, color: '#991b1b' }}>Possible duplicate awards</h3>
          <p className="muted">Same description + same approved amount more than once.</p>
          <div className="table-wrap" style={{ maxHeight: 200, overflow: 'auto' }}>
            <table>
              <thead>
                <tr><th>Description</th><th className="right">Amount</th><th>Times</th><th>Contractors</th></tr>
              </thead>
              <tbody>
                {awardDupes.slice(0, 20).map((g, i) => (
                  <tr key={i}>
                    <td>{g.title}</td>
                    <td className="right">{g.amount.toLocaleString()}</td>
                    <td><span className="tag rejected">{g.list.length}×</span></td>
                    <td>{g.contractors.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <h3>By award type</h3>
          <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Type</th><th className="right">N</th><th className="right">Approved ₦</th></tr></thead>
              <tbody>
                {byCategory.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="right">{c.count}</td>
                    <td className="right">{c.given.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h3>Top contractors (filtered)</h3>
          <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Contractor</th><th className="right">N</th><th className="right">Approved ₦</th></tr></thead>
              <tbody>
                {byContractor.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="right">{c.count}</td>
                    <td className="right">{c.given.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 180 }}>
            <label>Estate</label>
            <select value={estateFilter} onChange={(e) => setEstateFilter(e.target.value)}>
              <option value="">All Estates</option>
              {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 180 }}>
            <label>Award type</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All types</option>
              {AWARD_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label>Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Contractor, description, portfolio, ref…"
            />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((r) => selected.has(r.id))}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>#</th>
                <th>Type</th>
                <th>Contractor</th>
                <th>Description</th>
                <th>Portfolio / units</th>
                <th>Estate</th>
                <th className="right">Contract ₦</th>
                <th className="right">Applied ₦</th>
                <th className="right">Approved ₦</th>
                <th>Approved date</th>
                <th>Progress</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
                  <td>{i + 1}</td>
                  <td><span className="tag PO">{r.award_category || '—'}</span></td>
                  <td><b>{r.contractor_name}</b></td>
                  <td style={{ maxWidth: 220, fontSize: 13 }}>{r.description}</td>
                  <td style={{ fontSize: 12 }}>{r.portfolio || r.house_numbers || '—'}</td>
                  <td>{r.estates?.name || '—'}</td>
                  <td className="right">{Number(r.contract_amount || 0).toLocaleString()}</td>
                  <td className="right">{Number(r.amount_applied || 0).toLocaleString()}</td>
                  <td className="right"><b>{Number(r.amount_given || 0).toLocaleString()}</b></td>
                  <td>{r.approval_date || r.award_date || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.progress || r.payment_note || '—'}</td>
                  <td>
                    <div className="flex">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={13} className="empty-state">
                    No awards yet. Use <b>Bulk Import Excel</b> — pick estate + type (Construction, Roofing, Variation…).
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, background: '#f1f5f9' }}>
                  <td colSpan={7}>TOTAL ({totals.count})</td>
                  <td className="right">{totals.contract.toLocaleString()}</td>
                  <td className="right">{totals.applied.toLocaleString()}</td>
                  <td className="right">{totals.given.toLocaleString()}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? 'Edit award' : 'New award'}</h3>
            <form onSubmit={handleSave}>
              <div className="grid cols-2">
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>Description *</label>
                  <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="field">
                  <label>Contractor / beneficiary</label>
                  <input value={form.contractor_name} onChange={(e) => setForm({ ...form, contractor_name: e.target.value })} />
                </div>
                <div className="field">
                  <label>Award type</label>
                  <select value={form.award_category} onChange={(e) => setForm({ ...form, award_category: e.target.value })}>
                    {AWARD_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Estate</label>
                  <select value={form.estate_id} onChange={(e) => setForm({ ...form, estate_id: e.target.value })}>
                    <option value="">—</option>
                    {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Portfolio / house nos</label>
                  <input value={form.portfolio} onChange={(e) => setForm({ ...form, portfolio: e.target.value, house_numbers: e.target.value })} />
                </div>
                <div className="field">
                  <label>Request vide / Reference</label>
                  <input value={form.request_ref} onChange={(e) => setForm({ ...form, request_ref: e.target.value })} />
                </div>
                <div className="field">
                  <label>Contract amount (₦)</label>
                  <input type="number" step="0.01" value={form.contract_amount} onChange={(e) => setForm({ ...form, contract_amount: e.target.value })} />
                </div>
                <div className="field">
                  <label>Amount applied (₦)</label>
                  <input type="number" step="0.01" value={form.amount_applied} onChange={(e) => setForm({ ...form, amount_applied: e.target.value })} />
                </div>
                <div className="field">
                  <label>Amount approved / paid (₦)</label>
                  <input type="number" step="0.01" value={form.amount_given} onChange={(e) => setForm({ ...form, amount_given: e.target.value })} />
                </div>
                <div className="field">
                  <label>Date of contract / award</label>
                  <input type="date" value={form.award_date} onChange={(e) => setForm({ ...form, award_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>Date of approval</label>
                  <input type="date" value={form.approval_date} onChange={(e) => setForm({ ...form, approval_date: e.target.value })} />
                </div>
                <div className="field">
                  <label>Reason / milestone</label>
                  <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. third and fourth milestones" />
                </div>
                <div className="field">
                  <label>Progress</label>
                  <input value={form.progress} onChange={(e) => setForm({ ...form, progress: e.target.value })} />
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
                </div>
                <div className="field">
                  <label>Comments</label>
                  <input value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} />
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>Remarks</label>
                  <textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
                </div>
              </div>
              {editing && (
                <DocumentAttachments
                  linkedTable="contract_awards"
                  linkedRecordId={editing.id}
                  estateId={editing.estate_id || form.estate_id}
                  title="Contract documents"
                />
              )}
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  {editing && (
                    <button type="button" className="btn btn-danger" onClick={() => { setShowModal(false); handleDelete(editing); }}>
                      Delete
                    </button>
                  )}
                </div>
                <div className="flex">
                  <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImport === true && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3>Bulk import awards</h3>
            <p className="muted">
              Choose the <b>estate</b> this sheet belongs to and the <b>type</b> of awards
              (Construction, Roofing, Variation, Infrastructure, Deed, Sales discount…).
            </p>
            <div className="field">
              <label>Estate *</label>
              <select value={importEstateId} onChange={(e) => setImportEstateId(e.target.value)}>
                <option value="">— Select estate —</option>
                {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Award type for this file *</label>
              <select value={importCategory} onChange={(e) => setImportCategory(e.target.value)}>
                {AWARD_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setShowImport(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!importEstateId}
                onClick={() => setShowImport('file')}
              >
                Continue to file…
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport === 'file' && (
        <BulkImportModal
          title={`Import ${importCategory} — awards`}
          tableName="contract_awards"
          fieldDefs={CONTRACT_FIELD_DEFS}
          estates={estates}
          presetEstateId={importEstateId}
          profile={profile}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load(); }}
          transformRecord={(r) => ({
            ...transformContractRecord(r, importCategory, importEstateId),
            created_by: profile?.id,
          })}
        />
      )}
    </div>
  );
}

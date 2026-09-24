import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { submitOrApplyUpdate, submitOrApplyDelete } from '../lib/recordActions';
import { fetchCustomFields } from '../lib/customFields';
import { blankToNull } from '../lib/sanitize';
import ManageColumnsModal from './ManageColumnsModal';
import BulkImportModal from './BulkImportModal';
import DocumentAttachments from './DocumentAttachments';
import { CustomFieldInputs, CustomFieldHeaders, CustomFieldCells } from './CustomFieldWidgets';

const BLANK = {
  subscriber_name: '', estate_id: '', property_type: '', reason: '', refund_made_by: '', account_to_be_paid: '',
  amount_subscriber_has: '', amount_requested: '', amount_approved: '', date_of_approval: '',
  account_paid_to: '', comments: '', remarks: '',
};

// Column mapping for bulk Excel import.
// Expected headers (flexible): Serial Number | DATE OF REFUND | WHO WAS REFUNDED | AMOUNT REFUNDED | REMARKS
export const REFUND_FIELD_DEFS = [
  {
    key: 'subscriber_name',
    label: 'Subscriber / Who Was Refunded',
    type: 'text',
    required: true,
    synonyms: [
      'subscriber', 'subscriber name', 'who was refunded', 'to whom refunded', 'to whom',
      'names', 'name', 'beneficiary', 'payee', 'refunded to', 'who was refunded name',
    ],
  },
  {
    key: 'property_type',
    label: 'Money For / Property Type',
    type: 'text',
    synonyms: [
      'money for / property type', 'money for', 'property type', 'type', 'house type',
      'unit type', 'for property', 'property',
    ],
  },
  {
    key: 'date_of_approval',
    label: 'Date Approved / Date of Refund',
    type: 'date',
    synonyms: [
      'date approved', 'date of approval', 'date of refund', 'refund date',
      'approval date', 'paid on', 'date paid',
    ],
  },
  {
    key: 'date_applied',
    label: 'Date Applied',
    type: 'date',
    synonyms: ['date applied', 'application date', 'date of application', 'applied on'],
  },
  {
    key: 'amount_approved',
    label: 'Amount Approved / Refunded',
    type: 'number',
    required: true,
    synonyms: [
      'amount approved', 'amount refunded', 'refund amount', 'sum refunded',
      'total refunded', 'approved amount',
    ],
  },
  {
    key: 'amount_requested',
    label: 'Amount Requested',
    type: 'number',
    synonyms: [
      'amount requested for', 'amount requested', 'requested amount', 'request amount',
    ],
  },
  {
    key: 'amount_subscriber_has',
    label: 'Amount Paid (by subscriber into project)',
    type: 'number',
    synonyms: [
      'amount paid', 'amount subscriber has', 'subscriber has', 'balance held',
      'total paid', 'sum paid',
    ],
  },
  {
    key: 'reason',
    label: 'Description / Reason',
    type: 'text',
    synonyms: [
      'description', 'reason', 'reason for refund', 'purpose', 'grounds',
    ],
  },
  {
    key: 'refund_made_by',
    label: 'Refund Made By',
    type: 'text',
    synonyms: ['refund made by', 'made by', 'processed by', 'approved by'],
  },
  {
    key: 'account_to_be_paid',
    label: 'Account To Be Paid',
    type: 'text',
    synonyms: ['account to be paid', 'account', 'bank account'],
  },
  {
    key: 'account_paid_to',
    label: 'Account Paid To',
    type: 'text',
    synonyms: ['account paid to', 'paid to'],
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
    synonyms: ['remarks', 'remark', 'notes', 'note'],
  },
];



export default function RefundsTab() {
  const { profile, isSupervisorPlus } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [estateFilter, setEstateFilter] = useState('');
  const [propertyTypeFilter, setPropertyTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [sortKey, setSortKey] = useState('date_of_approval');
  const [sortDir, setSortDir] = useState('desc');
  const [bulkPropertyType, setBulkPropertyType] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [editingRow, setEditingRow] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [customData, setCustomData] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: estatesData } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(estatesData || []);
    setCustomFields(await fetchCustomFields('refunds'));
    const { data } = await supabase
      .from('refunds')
      .select('*, estates(name)')
      .eq('is_deleted', false)
      .order('serial_no', { ascending: false });
    setRows(data || []);
    setSelected(new Set());
    setLoading(false);
  }

  const propertyTypes = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => { if (r.property_type) set.add(r.property_type); });
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const list = rows.filter((r) => {
      if (estateFilter && r.estate_id !== estateFilter) return false;
      if (propertyTypeFilter === '__unspecified__') {
        if ((r.property_type || '').trim()) return false;
      } else if (propertyTypeFilter && (r.property_type || '') !== propertyTypeFilter) return false;
      const hay = `${r.subscriber_name || ''} ${r.reason || ''} ${r.remarks || ''} ${r.property_type || ''}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === 'date_of_approval') {
        const da = a.date_of_approval || '';
        const db = b.date_of_approval || '';
        if (da !== db) return da < db ? -dir : dir;
        return 0;
      }
      if (sortKey === 'amount_approved' || sortKey === 'amount_requested') {
        return (Number(a[sortKey] || 0) - Number(b[sortKey] || 0)) * dir;
      }
      if (sortKey === 'serial_no') {
        return (Number(a.serial_no || 0) - Number(b.serial_no || 0)) * dir;
      }
      if (sortKey === 'estate') {
        const ea = (a.estates?.name || '').toLowerCase();
        const eb = (b.estates?.name || '').toLowerCase();
        return ea.localeCompare(eb) * dir;
      }
      const va = String(a[sortKey] ?? '').toLowerCase();
      const vb = String(b[sortKey] ?? '').toLowerCase();
      return va.localeCompare(vb) * dir;
    });
    return list;
  }, [rows, estateFilter, propertyTypeFilter, search, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'date_of_approval' || key === 'amount_approved' ? 'desc' : 'asc'); }
  }

  function sortLabel(key, label) {
    if (sortKey !== key) return label;
    return `${label} ${sortDir === 'asc' ? '▲' : '▼'}`;
  }

  // Overall totals (respecting current filters)
  const totals = useMemo(() => {
    let approved = 0;
    let requested = 0;
    filtered.forEach((r) => {
      approved += Number(r.amount_approved || 0);
      requested += Number(r.amount_requested || 0);
    });
    return { count: filtered.length, approved, requested };
  }, [filtered]);

  // Totals by estate (always over the full filtered set, grouped)
  const byEstate = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const key = r.estate_id || '__none__';
      const name = r.estates?.name || 'No estate assigned';
      if (!map.has(key)) map.set(key, { name, count: 0, approved: 0, requested: 0 });
      const rec = map.get(key);
      rec.count += 1;
      rec.approved += Number(r.amount_approved || 0);
      rec.requested += Number(r.amount_requested || 0);
    });
    return [...map.values()].sort((a, b) => b.approved - a.approved);
  }, [filtered]);

  // Totals by property type
  const byPropertyType = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const key = r.property_type?.trim() || 'Unspecified';
      if (!map.has(key)) map.set(key, { name: key, count: 0, approved: 0, requested: 0 });
      const rec = map.get(key);
      rec.count += 1;
      rec.approved += Number(r.amount_approved || 0);
      rec.requested += Number(r.amount_requested || 0);
    });
    return [...map.values()].sort((a, b) => b.approved - a.approved);
  }, [filtered]);


  /** Same person + same approved amount on more than one estate */
  const crossEstateDupes = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      const name = String(r.subscriber_name || '').trim().toLowerCase();
      if (!name) return;
      const amt = Number(r.amount_approved || 0);
      if (!(amt > 0)) return;
      const key = `${name}|${amt.toFixed(2)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return [...map.entries()]
      .map(([, list]) => {
        const estates = [...new Set(list.map((r) => r.estates?.name || r.estate_id || '—'))];
        return { list, estates, name: list[0].subscriber_name, amount: Number(list[0].amount_approved || 0) };
      })
      .filter((g) => g.estates.length > 1 || g.list.length > 1)
      .filter((g) => {
        // highlight multi-estate OR multi-row same amount
        const estateIds = new Set(g.list.map((r) => r.estate_id).filter(Boolean));
        return estateIds.size > 1 || g.list.length > 1;
      })
      .sort((a, b) => b.amount - a.amount);
  }, [rows]);

  function openNew() { setEditingRow(null); setForm(BLANK); setCustomData({}); setError(''); setShowModal(true); }
  function openEdit(row) {
    setEditingRow(row);
    setForm({
      subscriber_name: row.subscriber_name || '',
      estate_id: row.estate_id || '',
      property_type: row.property_type || '',
      reason: row.reason || '',
      refund_made_by: row.refund_made_by || '',
      account_to_be_paid: row.account_to_be_paid || '',
      amount_subscriber_has: row.amount_subscriber_has ?? '',
      amount_requested: row.amount_requested ?? '',
      amount_approved: row.amount_approved ?? '',
      date_of_approval: row.date_of_approval || '',
      account_paid_to: row.account_paid_to || '',
      comments: row.comments || '',
      remarks: row.remarks || '',
    });
    setCustomData(row.custom_data || {});
    setError(''); setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!form.subscriber_name.trim()) { setError('Subscriber name is required.'); return; }
    setSaving(true);
    const payload = blankToNull({
      ...form,
      estate_id: form.estate_id || null,
      property_type: form.property_type?.trim() || null,
      amount_subscriber_has: Number(form.amount_subscriber_has) || 0,
      amount_requested: Number(form.amount_requested) || 0,
      amount_approved: Number(form.amount_approved) || 0,
      custom_data: customData,
    }, ['date_of_approval']);

    if (editingRow) {
      const { error, requiresApproval } = await submitOrApplyUpdate({ profile, tableName: 'refunds', recordId: editingRow.id, changes: payload });
      setSaving(false);
      if (error) { setError(error.message); return; }
      setShowModal(false);
      alert(requiresApproval ? 'Edit submitted for approval.' : 'Updated.');
      load();
      return;
    }
    const { error } = await supabase.from('refunds').insert({ ...payload, created_by: profile.id });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setShowModal(false);
    load();
  }

  async function handleDelete(row) {
    const reason = prompt('Reason for deleting this record (required):');
    if (!reason) return;
    const { error, requiresApproval } = await submitOrApplyDelete({ profile, tableName: 'refunds', recordId: row.id, reason });
    if (error) { alert(error.message); return; }
    alert(requiresApproval ? 'Delete request submitted for approval.' : 'Deleted.');
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

  function toggleSelectAllFiltered() {
    if (filtered.length && filtered.every((r) => selected.has(r.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((r) => r.id)));
    }
  }

  /** Soft-delete selected rows (chunks). Bypasses one-by-one approval for bulk clean-up. */
  async function handleDeleteSelected() {
    const ids = [...selected];
    if (!ids.length) { alert('Select at least one row first.'); return; }
    if (!confirm(`Soft-delete ${ids.length} selected refund record(s)? They will leave the list.`)) return;
    setBulkBusy(true);
    let done = 0;
    let errMsg = '';
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from('refunds')
        .update({ is_deleted: true })
        .in('id', chunk)
        .select('id');
      if (error) { errMsg = error.message; break; }
      done += (data || []).length;
    }
    setBulkBusy(false);
    if (errMsg) alert(`Deleted ${done}. Error: ${errMsg}`);
    else alert(`Deleted ${done} refund record(s).`);
    load();
  }

  /** Soft-delete every row currently shown by filters (estate / type / search). */
  async function handleDeleteAllFiltered() {
    if (!filtered.length) { alert('No rows match the current filters.'); return; }
    if (!confirm(
      `Soft-delete ALL ${filtered.length} refund row(s) currently shown (filters applied)?\n\nTip: filter to the wrong estate or "Unspecified" first, then run this.`
    )) return;
    const typed = prompt(`Type DELETE ${filtered.length} to confirm:`);
    if (typed !== `DELETE ${filtered.length}`) { alert('Cancelled.'); return; }
    setSelected(new Set(filtered.map((r) => r.id)));
    // reuse selected delete path
    const ids = filtered.map((r) => r.id);
    setBulkBusy(true);
    let done = 0;
    let errMsg = '';
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from('refunds')
        .update({ is_deleted: true })
        .in('id', chunk)
        .select('id');
      if (error) { errMsg = error.message; break; }
      done += (data || []).length;
    }
    setBulkBusy(false);
    if (errMsg) alert(`Deleted ${done}. Error: ${errMsg}`);
    else alert(`Deleted ${done} refund record(s).`);
    load();
  }

  /** Set property type on all currently filtered rows (e.g. after import without a type). */
  async function handleBulkSetPropertyType() {
    const pt = bulkPropertyType.trim();
    if (!pt) { alert('Enter or choose a property type first (e.g. 2 Bedroom).'); return; }
    if (!filtered.length) { alert('No rows match the current filters.'); return; }
    const ok = confirm(
      `Set property type to "${pt}" on ${filtered.length} refund row(s) currently shown (filters applied)?`
    );
    if (!ok) return;
    setBulkBusy(true);
    const ids = filtered.map((r) => r.id);
    // Update in chunks
    let updated = 0;
    let errMsg = '';
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error } = await supabase
        .from('refunds')
        .update({ property_type: pt })
        .in('id', chunk)
        .select('id');
      if (error) { errMsg = error.message; break; }
      updated += (data || []).length;
    }
    setBulkBusy(false);
    if (errMsg) alert(`Updated ${updated} row(s). Error: ${errMsg}`);
    else alert(`Updated property type on ${updated} refund row(s).`);
    load();
  }

  async function handleClearAllRefunds() {
    const scope = estateFilter
      ? `all refunds for the selected estate filter (${filtered.length} visible — will clear ALL non-deleted refunds for that estate in the database)`
      : 'ALL refunds in the system';
    if (!confirm(`Clear ${scope}? This soft-deletes records so they leave the list.`)) return;
    const typed = prompt('Type DELETE REFUNDS to confirm:');
    if (typed !== 'DELETE REFUNDS') { alert('Cancelled.'); return; }
    setBulkBusy(true);
    let q = supabase.from('refunds').update({ is_deleted: true }).eq('is_deleted', false);
    if (estateFilter) q = q.eq('estate_id', estateFilter);
    const { error } = await q;
    setBulkBusy(false);
    if (error) { alert(error.message); return; }
    alert('Refunds cleared.');
    load();
  }

  // Import transform: if amount_requested missing, copy amount_approved
  function transformImportRecord(r) {
    const amountApproved = Number(r.amount_approved) || 0;
    const amountRequested = Number(r.amount_requested) || amountApproved;
    const bits = [];
    if (r.date_applied) bits.push(`Applied: ${r.date_applied}`);
    if (r.date_applied && r.remarks) { /* keep remarks */ }
    const extra = bits.join(' · ');
    // date_applied is not always a DB column — fold into remarks/comments
    const { date_applied, ...rest } = r;
    return {
      ...rest,
      amount_approved: amountApproved,
      amount_requested: amountRequested,
      amount_subscriber_has: Number(r.amount_subscriber_has) || 0,
      property_type: (r.property_type || '').trim() || null,
      subscriber_name: String(r.subscriber_name || '').trim(),
      remarks: [r.remarks, extra].filter(Boolean).join(' · ') || null,
      reason: r.reason || null,
      comments: r.comments || null,
    };
  }

  return (
    <div>
      <div className="page-title">
        <h2>Refunds</h2>
        <div className="flex">
          <button className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button className="btn btn-outline" onClick={() => setShowImport(true)}>Bulk Import</button>
          <button
            className="btn btn-danger"
            onClick={handleDeleteSelected}
            disabled={bulkBusy || selected.size === 0}
          >
            {bulkBusy ? 'Working…' : `Delete selected (${selected.size})`}
          </button>
          <button
            className="btn btn-danger"
            onClick={handleDeleteAllFiltered}
            disabled={bulkBusy || filtered.length === 0}
            title="Deletes every row matching current filters"
          >
            Delete all filtered ({filtered.length})
          </button>
          <button className="btn btn-outline" onClick={handleClearAllRefunds} disabled={bulkBusy}>
            {bulkBusy ? 'Working…' : 'Clear All Refunds'}
          </button>
          <button className="btn btn-primary" onClick={openNew}>+ New Refund Entry</button>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat-card">
          <div className="value">{totals.count}</div>
          <div className="label">Refund Entries</div>
        </div>
        <div className="stat-card blue">
          <div className="value">₦{totals.requested.toLocaleString()}</div>
          <div className="label">Total Requested</div>
        </div>
        <div className="stat-card gold">
          <div className="value">₦{totals.approved.toLocaleString()}</div>
          <div className="label">Total Refunded (Approved)</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          
      {crossEstateDupes.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #dc2626', background: '#fef2f2' }}>
          <h3 style={{ marginTop: 0, color: '#991b1b' }}>Possible duplicate refunds</h3>
          <p className="muted">
            Same subscriber and same approved amount appearing more than once (including across estates).
            Review whether these are legitimate separate refunds or double-recording.
          </p>
          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Subscriber</th>
                  <th className="right">Amount (₦)</th>
                  <th>Times</th>
                  <th>Estates</th>
                </tr>
              </thead>
              <tbody>
                {crossEstateDupes.slice(0, 40).map((g, i) => (
                  <tr key={i}>
                    <td>{g.name}</td>
                    <td className="right">{g.amount.toLocaleString()}</td>
                    <td><span className="tag rejected">{g.list.length}×</span></td>
                    <td>{g.estates.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

          <h3>Total Refunded by Estate</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Estate</th>
                  <th className="right">Entries</th>
                  <th className="right">Requested (₦)</th>
                  <th className="right">Refunded (₦)</th>
                </tr>
              </thead>
              <tbody>
                {byEstate.map((e) => (
                  <tr key={e.name}>
                    <td>{e.name}</td>
                    <td className="right">{e.count}</td>
                    <td className="right">{e.requested.toLocaleString()}</td>
                    <td className="right"><b>{e.approved.toLocaleString()}</b></td>
                  </tr>
                ))}
                {byEstate.length === 0 && (
                  <tr><td colSpan={4} className="empty-state">No refunds yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3>Total Refunded by Property Type</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Property Type</th>
                  <th className="right">Entries</th>
                  <th className="right">Requested (₦)</th>
                  <th className="right">Refunded (₦)</th>
                </tr>
              </thead>
              <tbody>
                {byPropertyType.map((e) => (
                  <tr key={e.name}>
                    <td>{e.name}</td>
                    <td className="right">{e.count}</td>
                    <td className="right">{e.requested.toLocaleString()}</td>
                    <td className="right"><b>{e.approved.toLocaleString()}</b></td>
                  </tr>
                ))}
                {byPropertyType.length === 0 && (
                  <tr><td colSpan={4} className="empty-state">No refunds yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Tip: set <b>Property Type</b> on each refund (or use Default Property Type during Bulk Import)
            so this breakdown is accurate.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 200 }}>
            <label>Filter by Estate</label>
            <select value={estateFilter} onChange={(e) => setEstateFilter(e.target.value)}>
              <option value="">All Estates</option>
              {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 180 }}>
            <label>Filter by Property Type</label>
            <select value={propertyTypeFilter} onChange={(e) => setPropertyTypeFilter(e.target.value)}>
              <option value="">All Types</option>
              <option value="__unspecified__">Unspecified only (—)</option>
              {propertyTypes.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <label>Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, reason, remarks…"
            />
          </div>
        </div>
        <div className="flex wrap" style={{ marginTop: 12, alignItems: 'flex-end', gap: 10, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          <div style={{ minWidth: 200 }}>
            <label>Fix property type on shown rows</label>
            <input
              list="refund-property-types"
              value={bulkPropertyType}
              onChange={(e) => setBulkPropertyType(e.target.value)}
              placeholder="e.g. 2 Bedroom / 2BR — Old Rate"
            />
            <datalist id="refund-property-types">
              {propertyTypes.map((pt) => <option key={pt} value={pt} />)}
            </datalist>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            disabled={bulkBusy || !filtered.length}
            onClick={handleBulkSetPropertyType}
          >
            {bulkBusy ? 'Updating…' : `Apply to ${filtered.length} shown row(s)`}
          </button>
          <p className="muted" style={{ margin: 0, flex: 1 }}>
            Use this if you imported without a property type. Filter to the estate (and Unspecified if needed), type the correct type, then Apply.
          </p>
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
                    onChange={toggleSelectAllFiltered}
                    title="Select all filtered rows"
                  />
                </th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('serial_no')}>{sortLabel('serial_no', 'S/N')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('subscriber_name')}>{sortLabel('subscriber_name', 'Subscriber')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('estate')}>{sortLabel('estate', 'Estate')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('property_type')}>{sortLabel('property_type', 'Property Type')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('reason')}>{sortLabel('reason', 'Reason')}</th>
                <th className="right" style={{ cursor: 'pointer' }} onClick={() => toggleSort('amount_requested')}>{sortLabel('amount_requested', 'Requested (₦)')}</th>
                <th className="right" style={{ cursor: 'pointer' }} onClick={() => toggleSort('amount_approved')}>{sortLabel('amount_approved', 'Refunded (₦)')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('date_of_approval')}>{sortLabel('date_of_approval', 'Date of Refund')}</th>
                <th>Remarks</th>
                <CustomFieldHeaders fields={customFields} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={r.id}
                  style={{ cursor: r.estate_id && r.subscriber_name ? 'pointer' : undefined }}
                  onClick={() => {
                    if (r.estate_id && r.subscriber_name) {
                      navigate(`/subscriber/${r.estate_id}/${encodeURIComponent(r.subscriber_name)}`);
                    }
                  }}
                  title={r.estate_id ? 'Open profile' : undefined}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                    />
                  </td>
                  <td>{r.serial_no ?? i + 1}</td>
                  <td>
                    {r.estate_id ? (
                      <Link to={`/subscriber/${r.estate_id}/${encodeURIComponent(r.subscriber_name)}`} onClick={(e) => e.stopPropagation()}>
                        {r.subscriber_name}
                      </Link>
                    ) : r.subscriber_name}
                  </td>
                  <td>{r.estates?.name || '—'}</td>
                  <td>{r.property_type || '—'}</td>
                  <td>{r.reason || '—'}</td>
                  <td className="right">{Number(r.amount_requested || 0).toLocaleString()}</td>
                  <td className="right"><b>{Number(r.amount_approved || 0).toLocaleString()}</b></td>
                  <td>{r.date_of_approval || '—'}</td>
                  <td>{r.remarks || '—'}</td>
                  <CustomFieldCells fields={customFields} values={r.custom_data} />
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11 + customFields.length} className="empty-state">
                    No refund entries found. Use <b>Bulk Import</b> or <b>+ New Refund Entry</b> to add records.
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, background: '#f1f5f9' }}>
                  <td colSpan={6}>TOTAL ({totals.count} refund{totals.count === 1 ? '' : 's'})</td>
                  <td className="right">{totals.requested.toLocaleString()}</td>
                  <td className="right">{totals.approved.toLocaleString()}</td>
                  <td colSpan={2 + customFields.length + 1}></td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
      {!isSupervisorPlus && (
        <p className="muted" style={{ marginTop: 8 }}>Edits/deletes require supervisor or admin approval.</p>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRow ? 'Edit Refund Entry' : 'New Refund Entry'}</h3>
            <form onSubmit={handleSave}>
              <div className="grid cols-2">
                <div className="field">
                  <label>Who Was Refunded (Subscriber Name)</label>
                  <input
                    value={form.subscriber_name}
                    onChange={(e) => setForm({ ...form, subscriber_name: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Estate</label>
                  <select value={form.estate_id} onChange={(e) => setForm({ ...form, estate_id: e.target.value })}>
                    <option value="">— Not estate-specific —</option>
                    {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Property Type</label>
                  <input
                    value={form.property_type}
                    onChange={(e) => setForm({ ...form, property_type: e.target.value })}
                    placeholder="e.g. 2BR, 3BR, 4BR Semi"
                    list="refund-property-types"
                  />
                  <datalist id="refund-property-types">
                    {propertyTypes.map((pt) => <option key={pt} value={pt} />)}
                  </datalist>
                </div>
                <div className="field">
                  <label>Date of Refund</label>
                  <input
                    type="date"
                    value={form.date_of_approval}
                    onChange={(e) => setForm({ ...form, date_of_approval: e.target.value })}
                  />
                </div>
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label>Reason for Refund</label>
                  <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                </div>
                <div className="field">
                  <label>Amount Refunded / Approved (₦)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.amount_approved}
                    onChange={(e) => setForm({ ...form, amount_approved: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Amount Requested (₦)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.amount_requested}
                    onChange={(e) => setForm({ ...form, amount_requested: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Amount Subscriber Has (₦)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.amount_subscriber_has}
                    onChange={(e) => setForm({ ...form, amount_subscriber_has: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Refund Made By</label>
                  <input value={form.refund_made_by} onChange={(e) => setForm({ ...form, refund_made_by: e.target.value })} />
                </div>
                <div className="field">
                  <label>Account To Be Paid</label>
                  <input value={form.account_to_be_paid} onChange={(e) => setForm({ ...form, account_to_be_paid: e.target.value })} />
                </div>
                <div className="field">
                  <label>Account Paid To</label>
                  <input value={form.account_paid_to} onChange={(e) => setForm({ ...form, account_paid_to: e.target.value })} />
                </div>
              </div>
              {customFields.length > 0 && (
                <>
                  <div className="section-label">Additional Fields</div>
                  <CustomFieldInputs fields={customFields} values={customData} onChange={setCustomData} />
                </>
              )}
              <div className="field">
                <label>Comments</label>
                <textarea rows={2} value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} />
              </div>
              <div className="field">
                <label>Remarks</label>
                <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </div>
              {error && <div className="error-text">{error}</div>}
                            {editingRow && (
                <DocumentAttachments
                  linkedTable="refunds"
                  linkedRecordId={editingRow.id}
                  estateId={editingRow.estate_id}
                  subscriberName={editingRow.subscriber_name}
                  title="Refund documents"
                />
              )}
<div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  {editingRow && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => { setShowModal(false); handleDelete(editingRow); }}
                    >
                      Delete this record
                    </button>
                  )}
                </div>
                <div className="flex">
                  <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {showColumns && (
        <ManageColumnsModal tableName="refunds" onClose={() => setShowColumns(false)} onChanged={load} />
      )}

      {showImport && (
        <BulkImportModal
          title="Bulk Import Refunds"
          tableName="refunds"
          fieldDefs={REFUND_FIELD_DEFS}
          estates={estates}
          profile={profile}
          onClose={() => setShowImport(false)}
          onImported={load}
          transformRecord={transformImportRecord}
        />
      )}
    </div>
  );
}

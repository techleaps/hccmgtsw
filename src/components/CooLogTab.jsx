import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import BulkImportModal from './BulkImportModal';

export const COO_FIELD_DEFS = [
  {
    key: 'previous_owner',
    label: 'Initial Name / Previous Owner',
    type: 'text',
    required: true,
    synonyms: ['initial name', 'previous owner', 'old name', 'from', 'former owner', 'seller'],
  },
  {
    key: 'new_owner',
    label: 'New Name / New Owner',
    type: 'text',
    required: true,
    synonyms: ['new name', 'new owner', 'to', 'buyer', 'current owner'],
  },
  {
    key: 'date_changed',
    label: 'Date Processed',
    type: 'date',
    synonyms: ['date processed', 'date changed', 'processed date', 'coo date', 'date of coo'],
  },
  {
    key: 'property_type',
    label: 'Property Type',
    type: 'text',
    synonyms: ['property type', 'type', 'house type'],
  },
  {
    key: 'status',
    label: 'Status',
    type: 'text',
    synonyms: ['status', 'coo status', 'state'],
  },
  {
    key: 'new_allocation_no',
    label: 'Allocation / House No',
    type: 'text',
    synonyms: ['allocation', 'allocation no', 'house no', 'house number', 'unit'],
  },
  {
    key: 'previous_phone',
    label: 'Initial Phone',
    type: 'text',
    synonyms: ['phone number', 'initial phone', 'old phone'],
  },
  {
    key: 'previous_email',
    label: 'Initial Email',
    type: 'text',
    synonyms: ['email address', 'initial email', 'old email'],
  },
  {
    key: 'previous_address',
    label: 'Initial Address',
    type: 'text',
    synonyms: ['initial address', 'old address', 'address'],
  },
  {
    key: 'new_phone',
    label: 'New Phone',
    type: 'text',
    synonyms: ['new phone', 'new phone number'],
  },
  {
    key: 'new_email',
    label: 'New Email',
    type: 'text',
    synonyms: ['new email', 'new email address'],
  },
  {
    key: 'new_address',
    label: 'New Address',
    type: 'text',
    synonyms: ['new address'],
  },
  {
    key: 'remarks',
    label: 'Remarks',
    type: 'text',
    synonyms: ['remarks', 'remark', 'notes', 'note'],
  },
  {
    key: 'comments',
    label: 'Comments / MD note',
    type: 'text',
    synonyms: ['comments', 'comment', "md's first comment", 'md comment'],
  },
];

function ensureIsoDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const s = String(v).trim();
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const m2 = s.match(/^(\d{1,2})[\/\-\s]+([A-Za-z]{3,9})[\/\-\s]+(\d{2,4})$/);
  if (m2) {
    const dd = m2[1].padStart(2, '0');
    const mon = months[m2[2].toLowerCase().slice(0, 3)];
    let y = m2[3];
    if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`;
    if (mon) return `${y.padStart(4, '0')}-${String(mon).padStart(2, '0')}-${dd}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
}

function transformCooRecord(r) {
  const bits = [];
  if (r.previous_address) bits.push(`Prev address: ${r.previous_address}`);
  if (r.previous_phone) bits.push(`Prev phone: ${r.previous_phone}`);
  if (r.previous_email) bits.push(`Prev email: ${r.previous_email}`);
  if (r.new_address) bits.push(`New address: ${r.new_address}`);
  if (r.new_phone) bits.push(`New phone: ${r.new_phone}`);
  if (r.new_email) bits.push(`New email: ${r.new_email}`);
  if (r.status) bits.push(`Status: ${r.status}`);
  const extra = bits.join(' · ');
  const comments = [r.comments, extra].filter(Boolean).join(' | ') || null;
  let dateChanged = ensureIsoDate(r.date_changed);
  if (!dateChanged) dateChanged = new Date().toISOString().slice(0, 10);
  return {
    previous_owner: String(r.previous_owner || '').trim(),
    new_owner: String(r.new_owner || '').trim(),
    date_changed: dateChanged,
    property_type: r.property_type || null,
    status: r.status || null,
    new_allocation_no: r.new_allocation_no || null,
    remarks: r.remarks || null,
    comments,
    reason: r.status ? `COO (${r.status})` : 'Change of ownership',
  };
}

const EDIT_BLANK = {
  previous_owner: '',
  new_owner: '',
  date_changed: '',
  property_type: '',
  status: '',
  new_allocation_no: '',
  amount_paid: '',
  reason: '',
  remarks: '',
  comments: '',
  estate_id: '',
};

export default function CooLogTab() {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [estateFilter, setEstateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [importStep, setImportStep] = useState(null);
  const [importEstateId, setImportEstateId] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null); // row opened
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EDIT_BLANK);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: estatesData } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(estatesData || []);
    const { data } = await supabase
      .from('ownership_changes')
      .select('*, offers(estate_id, estates(name)), allocation_records(estate_id, estates(name)), estates(name)')
      .order('created_at', { ascending: false });
    setRows(data || []);
    setSelected(new Set());
    setLoading(false);
  }

  function estateOf(r) {
    return r.estates?.name
      || r.offers?.estates?.name
      || r.allocation_records?.estates?.name
      || '—';
  }
  function estateIdOf(r) {
    return r.estate_id || r.offers?.estate_id || r.allocation_records?.estate_id || null;
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (estateFilter && estateIdOf(r) !== estateFilter) return false;
      const hay = `${r.previous_owner} ${r.new_owner} ${r.property_type || ''}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
  }, [rows, estateFilter, search]);

  const totalFees = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.amount_paid || 0), 0),
    [filtered]
  );

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    if (selected.size && filtered.every((r) => selected.has(r.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((r) => r.id)));
    }
  }

  async function deleteIds(ids) {
    if (!ids.length) return;
    const msg = ids.length === 1
      ? 'Delete this COO record permanently?'
      : `Delete ${ids.length} selected COO record(s) permanently?`;
    if (!confirm(msg)) return;
    setBusy(true);
    const { error: err } = await supabase.from('ownership_changes').delete().in('id', ids);
    setBusy(false);
    if (err) { alert(err.message); return; }
    setDetail(null);
    setEditing(false);
    load();
  }

  function openDetail(r) {
    setDetail(r);
    setEditing(false);
    setError('');
    setForm({
      previous_owner: r.previous_owner || '',
      new_owner: r.new_owner || '',
      date_changed: r.date_changed ? String(r.date_changed).slice(0, 10) : '',
      property_type: r.property_type || '',
      status: r.status || '',
      new_allocation_no: r.new_allocation_no || r.new_pon || '',
      amount_paid: r.amount_paid ?? '',
      reason: r.reason || '',
      remarks: r.remarks || '',
      comments: r.comments || '',
      estate_id: estateIdOf(r) || '',
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!detail) return;
    if (!form.previous_owner.trim() || !form.new_owner.trim()) {
      setError('Previous and new owner names are required.');
      return;
    }
    setBusy(true);
    const payload = {
      previous_owner: form.previous_owner.trim(),
      new_owner: form.new_owner.trim(),
      date_changed: form.date_changed || new Date().toISOString().slice(0, 10),
      property_type: form.property_type || null,
      status: form.status || null,
      new_allocation_no: form.new_allocation_no || null,
      amount_paid: Number(form.amount_paid) || 0,
      reason: form.reason || null,
      remarks: form.remarks || null,
      comments: form.comments || null,
      estate_id: form.estate_id || null,
    };
    const { error: err } = await supabase.from('ownership_changes').update(payload).eq('id', detail.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setEditing(false);
    setDetail(null);
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Change of Ownership — History</h2>
          <p className="muted" style={{ margin: 0 }}>
            Click a row to open details. Edit or delete at the bottom of the detail panel.
          </p>
        </div>
        <div className="flex wrap">
          <Link className="btn btn-outline" to="/offers">Offers</Link>
          <Link className="btn btn-outline" to="/allocations">Allocations</Link>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || selected.size === 0}
            onClick={() => deleteIds([...selected])}
          >
            Delete selected ({selected.size})
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setImportEstateId(estateFilter || (estates[0]?.id || ''));
              setImportStep('estate');
            }}
          >
            Bulk Import COO
          </button>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat-card">
          <div className="value">{filtered.length}</div>
          <div className="label">Total Ownership Changes</div>
        </div>
        <div className="stat-card gold">
          <div className="value">₦{totalFees.toLocaleString()}</div>
          <div className="label">Total COO Fees Recorded</div>
        </div>
      </div>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 180 }}>
            <label>Filter by Estate</label>
            <select value={estateFilter} onChange={(e) => setEstateFilter(e.target.value)}>
              <option value="">All Estates</option>
              {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <label>Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search previous or new owner name…"
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
                    onChange={toggleAllVisible}
                    title="Select all visible"
                  />
                </th>
                <th>S/N</th>
                <th>Date</th>
                <th>Estate</th>
                <th>Previous Owner</th>
                <th>New Owner</th>
                <th>Property type</th>
                <th>House / Allocation</th>
                <th>Status</th>
                <th className="right">COO Fee (₦)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={r.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openDetail(r)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                    />
                  </td>
                  <td>{i + 1}</td>
                  <td>{r.date_changed || '—'}</td>
                  <td>{estateOf(r)}</td>
                  <td>{r.previous_owner}</td>
                  <td>
                    {estateIdOf(r) ? (
                      <Link
                        to={`/subscriber/${estateIdOf(r)}/${encodeURIComponent(r.new_owner)}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.new_owner}
                      </Link>
                    ) : r.new_owner}
                  </td>
                  <td>{r.property_type || '—'}</td>
                  <td>{r.new_pon || r.new_allocation_no || '—'}</td>
                  <td>{r.status || '—'}</td>
                  <td className="right">{Number(r.amount_paid || 0).toLocaleString()}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openDetail(r)}>Open</button>
                      <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => deleteIds([r.id])}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="empty-state">
                    No ownership changes yet. Use <b>Bulk Import COO</b> or <b>Record COO</b> on an allocation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => { if (!busy) { setDetail(null); setEditing(false); } }}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>COO record</h3>
            {!editing ? (
              <>
                <div className="grid cols-2">
                  <p><b>Date:</b> {detail.date_changed || '—'}</p>
                  <p><b>Estate:</b> {estateOf(detail)}</p>
                  <p><b>Previous owner:</b> {detail.previous_owner}</p>
                  <p><b>New owner:</b> {detail.new_owner}</p>
                  <p><b>Property type:</b> {detail.property_type || '—'}</p>
                  <p><b>House / Allocation:</b> {detail.new_pon || detail.new_allocation_no || '—'}</p>
                  <p><b>Status:</b> {detail.status || '—'}</p>
                  <p><b>COO fee:</b> ₦{Number(detail.amount_paid || 0).toLocaleString()}</p>
                  <p><b>Reason:</b> {detail.reason || '—'}</p>
                  <p><b>Remarks:</b> {detail.remarks || '—'}</p>
                  <p style={{ gridColumn: '1 / -1' }}><b>Comments:</b> {detail.comments || '—'}</p>
                </div>
                <div className="modal-actions" style={{ marginTop: 16, justify: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => deleteIds([detail.id])}>
                    Delete this record
                  </button>
                  <div className="flex">
                    <button type="button" className="btn btn-outline" onClick={() => { setDetail(null); setEditing(false); }}>Close</button>
                    <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>
                  </div>
                </div>
              </>
            ) : (
              <form onSubmit={saveEdit}>
                <div className="grid cols-2">
                  <div className="field">
                    <label>Previous owner *</label>
                    <input value={form.previous_owner} onChange={(e) => setForm({ ...form, previous_owner: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>New owner *</label>
                    <input value={form.new_owner} onChange={(e) => setForm({ ...form, new_owner: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>Date processed</label>
                    <input type="date" value={form.date_changed} onChange={(e) => setForm({ ...form, date_changed: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Estate</label>
                    <select value={form.estate_id} onChange={(e) => setForm({ ...form, estate_id: e.target.value })}>
                      <option value="">—</option>
                      {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Property type</label>
                    <input value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>House / Allocation</label>
                    <input value={form.new_allocation_no} onChange={(e) => setForm({ ...form, new_allocation_no: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Status</label>
                    <input value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} placeholder="ongoing / done" />
                  </div>
                  <div className="field">
                    <label>COO fee (₦)</label>
                    <input type="number" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} />
                  </div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <label>Reason</label>
                    <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Remarks</label>
                    <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Comments</label>
                    <input value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} />
                  </div>
                </div>
                {error && <div className="error-text">{error}</div>}
                <div className="modal-actions" style={{ marginTop: 16, justify: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => deleteIds([detail.id])}>
                    Delete this record
                  </button>
                  <div className="flex">
                    <button type="button" className="btn btn-outline" onClick={() => setEditing(false)}>Cancel edit</button>
                    <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {importStep === 'estate' && (
        <div className="modal-overlay" onClick={() => setImportStep(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3>Which estate is this COO sheet for?</h3>
            <p className="muted">
              Workbooks often have one sheet per estate. Select the estate, then choose the matching sheet in the file picker.
            </p>
            <div className="field">
              <label>Estate *</label>
              <select value={importEstateId} onChange={(e) => setImportEstateId(e.target.value)}>
                <option value="">— Select —</option>
                {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setImportStep(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!importEstateId}
                onClick={() => setImportStep('file')}
              >
                Continue to file…
              </button>
            </div>
          </div>
        </div>
      )}

      {importStep === 'file' && importEstateId && (
        <BulkImportModal
          title={`Bulk Import COO — ${estates.find((e) => e.id === importEstateId)?.name || ''}`}
          tableName="ownership_changes"
          fieldDefs={COO_FIELD_DEFS}
          estates={estates}
          presetEstateId={importEstateId}
          profile={profile}
          onClose={() => { setImportStep(null); setImportEstateId(''); }}
          onImported={() => { setImportStep(null); setImportEstateId(''); load(); }}
          transformRecord={(r) => ({
            ...transformCooRecord(r),
            estate_id: importEstateId,
            created_by: profile?.id,
            amount_paid: Number(r.amount_paid) || 0,
          })}
        />
      )}
    </div>
  );
}

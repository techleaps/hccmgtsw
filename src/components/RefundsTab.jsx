import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { submitOrApplyUpdate, submitOrApplyDelete } from '../lib/recordActions';
import { fetchCustomFields } from '../lib/customFields';
import { blankToNull } from '../lib/sanitize';
import ManageColumnsModal from './ManageColumnsModal';
import BulkImportModal from './BulkImportModal';
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
    label: 'Who Was Refunded / Subscriber Name',
    type: 'text',
    required: true,
    synonyms: [
      'who was refunded', 'who was refunded name', 'subscriber', 'subscriber name',
      'names', 'name', 'beneficiary', 'payee', 'refunded to',
    ],
  },
  {
    key: 'property_type',
    label: 'Property Type',
    type: 'text',
    synonyms: ['property type', 'type', 'house type', 'unit type'],
  },
  {
    key: 'date_of_approval',
    label: 'Date of Refund',
    type: 'date',
    synonyms: [
      'date of refund', 'refund date', 'date of approval', 'date approved',
      'date', 'approval date', 'paid on', 'date paid',
    ],
  },
  {
    key: 'amount_approved',
    label: 'Amount Refunded',
    type: 'number',
    required: true,
    synonyms: [
      'amount refunded', 'amount approved', 'refund amount', 'amount paid',
      'amount', 'refunded', 'sum refunded', 'total refunded',
    ],
  },
  {
    key: 'amount_requested',
    label: 'Amount Requested',
    type: 'number',
    synonyms: ['amount requested', 'requested amount', 'request amount'],
  },
  {
    key: 'amount_subscriber_has',
    label: 'Amount Subscriber Has',
    type: 'number',
    synonyms: ['amount subscriber has', 'subscriber has', 'balance held'],
  },
  {
    key: 'reason',
    label: 'Reason for Refund',
    type: 'text',
    synonyms: ['reason', 'reason for refund', 'purpose'],
  },
  {
    key: 'refund_made_by',
    label: 'Refund Made By',
    type: 'text',
    synonyms: ['refund made by', 'made by', 'processed by', 'approved by'],
  },
  {
    key: 'account_paid_to',
    label: 'Account Paid To',
    type: 'text',
    synonyms: ['account paid to', 'paid to', 'bank account', 'account'],
  },
  {
    key: 'account_to_be_paid',
    label: 'Account To Be Paid',
    type: 'text',
    synonyms: ['account to be paid', 'to be paid'],
  },
  {
    key: 'remarks',
    label: 'Remarks',
    type: 'text',
    synonyms: ['remarks', 'remark', 'comment', 'comments', 'note', 'notes'],
  },
  {
    key: 'comments',
    label: 'Comments',
    type: 'text',
    synonyms: ['comments', 'comment'],
  },
];

export default function RefundsTab() {
  const { profile, isSupervisorPlus } = useAuth();
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
    setLoading(false);
  }

  const propertyTypes = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => { if (r.property_type) set.add(r.property_type); });
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (estateFilter && r.estate_id !== estateFilter) return false;
    if (propertyTypeFilter && (r.property_type || '') !== propertyTypeFilter) return false;
    const hay = `${r.subscriber_name || ''} ${r.reason || ''} ${r.remarks || ''} ${r.property_type || ''}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  }), [rows, estateFilter, propertyTypeFilter, search]);

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

  // Import transform: if amount_requested missing, copy amount_approved
  function transformImportRecord(r) {
    const amountApproved = Number(r.amount_approved) || 0;
    const amountRequested = Number(r.amount_requested) || amountApproved;
    return {
      ...r,
      amount_approved: amountApproved,
      amount_requested: amountRequested,
      amount_subscriber_has: Number(r.amount_subscriber_has) || 0,
      property_type: r.property_type?.trim() || null,
      subscriber_name: String(r.subscriber_name || '').trim(),
    };
  }

  return (
    <div>
      <div className="page-title">
        <h2>Refunds</h2>
        <div className="flex">
          <button className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button className="btn btn-outline" onClick={() => setShowImport(true)}>Bulk Import</button>
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
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>S/N</th>
                <th>Subscriber</th>
                <th>Estate</th>
                <th>Property Type</th>
                <th>Reason</th>
                <th className="right">Requested (₦)</th>
                <th className="right">Refunded (₦)</th>
                <th>Date of Refund</th>
                <th>Remarks</th>
                <CustomFieldHeaders fields={customFields} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.serial_no}</td>
                  <td>{r.subscriber_name}</td>
                  <td>{r.estates?.name || '—'}</td>
                  <td>{r.property_type || '—'}</td>
                  <td>{r.reason || '—'}</td>
                  <td className="right">{Number(r.amount_requested || 0).toLocaleString()}</td>
                  <td className="right"><b>{Number(r.amount_approved || 0).toLocaleString()}</b></td>
                  <td>{r.date_of_approval || '—'}</td>
                  <td>{r.remarks || '—'}</td>
                  <CustomFieldCells fields={customFields} values={r.custom_data} />
                  <td>
                    <div className="flex">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10 + customFields.length} className="empty-state">
                    No refund entries found. Use <b>Bulk Import</b> or <b>+ New Refund Entry</b> to add records.
                  </td>
                </tr>
              )}
            </tbody>
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
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
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

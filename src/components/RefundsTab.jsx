import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { submitOrApplyUpdate, submitOrApplyDelete } from '../lib/recordActions';
import { fetchCustomFields } from '../lib/customFields';
import { blankToNull } from '../lib/sanitize';
import ManageColumnsModal from './ManageColumnsModal';
import { CustomFieldInputs, CustomFieldHeaders, CustomFieldCells } from './CustomFieldWidgets';

const BLANK = {
  subscriber_name: '', estate_id: '', reason: '', refund_made_by: '', account_to_be_paid: '',
  amount_subscriber_has: '', amount_requested: '', amount_approved: '', date_of_approval: '',
  account_paid_to: '', comments: '', remarks: '',
};

export default function RefundsTab() {
  const { profile, isSupervisorPlus } = useAuth();
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [estateFilter, setEstateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
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

  const filtered = useMemo(() => rows.filter((r) => {
    if (estateFilter && r.estate_id !== estateFilter) return false;
    return `${r.subscriber_name} ${r.reason}`.toLowerCase().includes(search.toLowerCase());
  }), [rows, estateFilter, search]);

  const totals = useMemo(() => ({
    requested: filtered.reduce((s, r) => s + Number(r.amount_requested || 0), 0),
    approved: filtered.reduce((s, r) => s + Number(r.amount_approved || 0), 0),
  }), [filtered]);

  function openNew() { setEditingRow(null); setForm(BLANK); setCustomData({}); setError(''); setShowModal(true); }
  function openEdit(row) {
    setEditingRow(row);
    setForm({
      subscriber_name: row.subscriber_name || '', estate_id: row.estate_id || '', reason: row.reason || '', refund_made_by: row.refund_made_by || '',
      account_to_be_paid: row.account_to_be_paid || '', amount_subscriber_has: row.amount_subscriber_has ?? '',
      amount_requested: row.amount_requested ?? '', amount_approved: row.amount_approved ?? '',
      date_of_approval: row.date_of_approval || '', account_paid_to: row.account_paid_to || '',
      comments: row.comments || '', remarks: row.remarks || '',
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

  return (
    <div>
      <div className="page-title">
        <h2>Refunds</h2>
        <div className="flex">
          <button className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button className="btn btn-primary" onClick={openNew}>+ New Refund Entry</button>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat-card"><div className="value">{filtered.length}</div><div className="label">Total Entries</div></div>
        <div className="stat-card blue"><div className="value">₦{totals.requested.toLocaleString()}</div><div className="label">Total Requested</div></div>
        <div className="stat-card gold"><div className="value">₦{totals.approved.toLocaleString()}</div><div className="label">Total Approved</div></div>
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
          <div style={{ minWidth: 220, flex: 1 }}>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by subscriber name or reason..." />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>S/N</th><th>Subscriber</th><th>Estate</th><th>Reason</th><th>Refund Made By</th><th>Requested (₦)</th>
                <th>Approved (₦)</th><th>Date</th><th>Account Paid To</th>
                <CustomFieldHeaders fields={customFields} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.serial_no}</td><td>{r.subscriber_name}</td><td>{r.estates?.name || '—'}</td><td>{r.reason}</td><td>{r.refund_made_by}</td>
                  <td className="right">{Number(r.amount_requested || 0).toLocaleString()}</td>
                  <td className="right">{Number(r.amount_approved || 0).toLocaleString()}</td>
                  <td>{r.date_of_approval}</td><td>{r.account_paid_to}</td>
                  <CustomFieldCells fields={customFields} values={r.custom_data} />
                  <td>
                    <div className="flex">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={10 + customFields.length} className="empty-state">No refund entries found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {!isSupervisorPlus && <p className="muted" style={{ marginTop: 8 }}>Edits/deletes require supervisor or admin approval.</p>}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRow ? 'Edit Refund Entry' : 'New Refund Entry'}</h3>
            <form onSubmit={handleSave}>
              <div className="grid cols-2">
                <div className="field"><label>Subscriber Name</label><input value={form.subscriber_name} onChange={(e) => setForm({ ...form, subscriber_name: e.target.value })} required /></div>
                <div className="field"><label>Estate (optional)</label>
                  <select value={form.estate_id} onChange={(e) => setForm({ ...form, estate_id: e.target.value })}>
                    <option value="">— Not estate-specific —</option>
                    {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label>Reason for Refund</label><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
                <div className="field"><label>Refund Made By</label><input value={form.refund_made_by} onChange={(e) => setForm({ ...form, refund_made_by: e.target.value })} /></div>
                <div className="field"><label>Account To Be Paid</label><input value={form.account_to_be_paid} onChange={(e) => setForm({ ...form, account_to_be_paid: e.target.value })} /></div>
                <div className="field"><label>Amount Subscriber Has (₦)</label><input type="number" step="0.01" value={form.amount_subscriber_has} onChange={(e) => setForm({ ...form, amount_subscriber_has: e.target.value })} /></div>
                <div className="field"><label>Amount Requested (₦)</label><input type="number" step="0.01" value={form.amount_requested} onChange={(e) => setForm({ ...form, amount_requested: e.target.value })} /></div>
                <div className="field"><label>Amount Approved (₦)</label><input type="number" step="0.01" value={form.amount_approved} onChange={(e) => setForm({ ...form, amount_approved: e.target.value })} /></div>
                <div className="field"><label>Date of Approval</label><input type="date" value={form.date_of_approval} onChange={(e) => setForm({ ...form, date_of_approval: e.target.value })} /></div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label>Account Paid To</label><input value={form.account_paid_to} onChange={(e) => setForm({ ...form, account_paid_to: e.target.value })} /></div>
              </div>
              {customFields.length > 0 && (
                <>
                  <div className="section-label">Additional Fields</div>
                  <CustomFieldInputs fields={customFields} values={customData} onChange={setCustomData} />
                </>
              )}
              <div className="field"><label>Comments</label><textarea rows={2} value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} /></div>
              <div className="field"><label>Remarks</label><input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showColumns && <ManageColumnsModal tableName="refunds" onClose={() => setShowColumns(false)} onChanged={load} />}
    </div>
  );
}

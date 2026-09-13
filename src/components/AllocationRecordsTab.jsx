import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { submitOrApplyUpdate, submitOrApplyDelete } from '../lib/recordActions';
import { fetchCustomFields } from '../lib/customFields';
import ManageColumnsModal from './ManageColumnsModal';
import BulkImportModal from './BulkImportModal';
import { CustomFieldInputs, CustomFieldHeaders, CustomFieldCells } from './CustomFieldWidgets';

const BLANK = {
  estate_id: '', subscriber_name: '', house_no: '', property_type: '',
  printed: false, signed: false, collected: false, collected_by: '', collected_date: '',
  phone_number: '', remarks: '',
};

export const ALLOCATION_FIELD_DEFS = [
  { key: 'subscriber_name', label: 'Subscriber Name', type: 'text', required: true, synonyms: ['subscriber', 'name'] },
  { key: 'house_no', label: 'House No', type: 'text', synonyms: ['house no', 'house number', 'allocation no', 'plot no'] },
  { key: 'property_type', label: 'Property Type', type: 'text', synonyms: ['property type', 'type'] },
  { key: 'printed', label: 'Printed', type: 'checkbox', synonyms: ['printed'] },
  { key: 'signed', label: 'Signed', type: 'checkbox', synonyms: ['signed'] },
  { key: 'collected', label: 'Collected', type: 'checkbox', synonyms: ['collected'] },
  { key: 'collected_by', label: 'Collected By', type: 'text', synonyms: ['collected by'] },
  { key: 'collected_date', label: 'Date Collected', type: 'date', synonyms: ['date collected', 'collected on', 'collected date'] },
  { key: 'phone_number', label: 'Phone Number', type: 'text', synonyms: ['phone number', 'phone', 'tel'] },
  { key: 'remarks', label: 'Remarks', type: 'text', synonyms: ['remarks', 'comment', 'comments'] },
];

export default function AllocationRecordsTab() {
  const { profile, isSupervisorPlus } = useAuth();
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [estateFilter, setEstateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
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

  const [cooRow, setCooRow] = useState(null);
  const [cooForm, setCooForm] = useState({ new_owner: '', reason: '', new_allocation_no: '', comments: '' });
  const [cooSaving, setCooSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: estatesData } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(estatesData || []);
    setCustomFields(await fetchCustomFields('allocation_records'));
    const { data } = await supabase
      .from('allocation_records')
      .select('*, estates(name)')
      .eq('is_deleted', false)
      .order('serial_no', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (estateFilter && r.estate_id !== estateFilter) return false;
      if (statusFilter === 'signed' && !r.signed) return false;
      if (statusFilter === 'collected' && !r.collected) return false;
      if (statusFilter === 'pending' && r.collected) return false;
      const hay = `${r.subscriber_name} ${r.house_no || ''} ${r.phone_number || ''}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
  }, [rows, estateFilter, statusFilter, search]);

  const summary = useMemo(() => ({
    total: filtered.length,
    signed: filtered.filter((r) => r.signed).length,
    collected: filtered.filter((r) => r.collected).length,
  }), [filtered]);

  function openNew() { setEditingRow(null); setForm(BLANK); setCustomData({}); setError(''); setShowModal(true); }
  function openEdit(row) {
    setEditingRow(row);
    setForm({
      estate_id: row.estate_id, subscriber_name: row.subscriber_name || '', house_no: row.house_no || '',
      property_type: row.property_type || '', printed: row.printed, signed: row.signed, collected: row.collected,
      collected_by: row.collected_by || '', collected_date: row.collected_date || '', phone_number: row.phone_number || '',
      remarks: row.remarks || '',
    });
    setCustomData(row.custom_data || {});
    setError(''); setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!form.estate_id || !form.subscriber_name.trim()) {
      setError('Estate and Subscriber Name are required.');
      return;
    }
    setSaving(true);
    const payload = { ...form, custom_data: customData };

    if (editingRow) {
      const { error, requiresApproval } = await submitOrApplyUpdate({ profile, tableName: 'allocation_records', recordId: editingRow.id, changes: payload });
      setSaving(false);
      if (error) { setError(error.message); return; }
      setShowModal(false);
      alert(requiresApproval ? 'Edit submitted for supervisor/admin approval.' : 'Record updated.');
      load();
      return;
    }
    const { error } = await supabase.from('allocation_records').insert({ ...payload, created_by: profile.id });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setShowModal(false);
    load();
  }

  async function handleDelete(row) {
    const reason = prompt('Reason for deleting this record (required):');
    if (!reason) return;
    const { error, requiresApproval } = await submitOrApplyDelete({ profile, tableName: 'allocation_records', recordId: row.id, reason });
    if (error) { alert(error.message); return; }
    alert(requiresApproval ? 'Delete request submitted for approval.' : 'Record deleted.');
    load();
  }

  function openCoo(row) {
    setCooRow(row);
    setCooForm({ new_owner: '', reason: '', new_allocation_no: row.house_no || '', comments: '' });
    setError('');
  }

  async function handleCooSubmit(e) {
    e.preventDefault();
    setError('');
    if (!cooForm.new_owner.trim()) { setError('Enter the new owner name.'); return; }
    setCooSaving(true);
    const { error: logError } = await supabase.from('ownership_changes').insert({
      allocation_record_id: cooRow.id, previous_owner: cooRow.subscriber_name, new_owner: cooForm.new_owner.trim(),
      reason: cooForm.reason, new_allocation_no: cooForm.new_allocation_no, comments: cooForm.comments, created_by: profile.id,
    });
    if (logError) { setError(logError.message); setCooSaving(false); return; }
    const { error: updError, requiresApproval } = await submitOrApplyUpdate({
      profile, tableName: 'allocation_records', recordId: cooRow.id,
      changes: { subscriber_name: cooForm.new_owner.trim(), house_no: cooForm.new_allocation_no },
      reason: `Change of Ownership: ${cooForm.reason || ''}`,
    });
    setCooSaving(false);
    if (updError) { setError(updError.message); return; }
    setCooRow(null);
    alert(requiresApproval ? 'Ownership change logged; name update sent for approval.' : 'Ownership change recorded.');
    load();
  }

  return (
    <div>
      <div className="page-title">
        <h2>Allocations Register</h2>
        <div className="flex wrap">
          <button className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button className="btn btn-outline" onClick={() => setShowImport(true)}>Bulk Import from Excel</button>
          <button className="btn btn-primary" onClick={openNew}>+ New Allocation</button>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat-card"><div className="value">{summary.total}</div><div className="label">Allocations Shown</div></div>
        <div className="stat-card blue"><div className="value">{summary.signed}</div><div className="label">Signed</div></div>
        <div className="stat-card gold"><div className="value">{summary.collected}</div><div className="label">Collected</div></div>
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
          <div style={{ minWidth: 180 }}>
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="signed">Signed</option>
              <option value="collected">Collected</option>
              <option value="pending">Not Yet Collected</option>
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, house no, phone…" />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>S/N</th><th>Estate</th><th>House No</th><th>Subscriber Name</th><th>Property Type</th>
                <th>Printed</th><th>Signed</th><th>Collected</th><th>Collected By</th><th>Date Collected</th><th>Phone</th>
                <CustomFieldHeaders fields={customFields} />
                <th>Remarks</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.serial_no}</td>
                  <td>{r.estates?.name}</td>
                  <td>{r.house_no}</td>
                  <td>{r.subscriber_name}</td>
                  <td>{r.property_type}</td>
                  <td>{r.printed ? '✓' : ''}</td>
                  <td>{r.signed ? '✓' : ''}</td>
                  <td>{r.collected ? '✓' : ''}</td>
                  <td>{r.collected_by}</td>
                  <td>{r.collected_date}</td>
                  <td>{r.phone_number}</td>
                  <CustomFieldCells fields={customFields} values={r.custom_data} />
                  <td>{r.remarks}</td>
                  <td>
                    <div className="flex wrap">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-outline btn-sm" onClick={() => openCoo(r)}>Record COO</button>
                      <Link className="btn btn-outline btn-sm" to={`/documents?linkedTable=allocation_records&linkedRecordId=${r.id}`}>Docs</Link>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={14 + customFields.length} className="empty-state">No allocation records found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {!isSupervisorPlus && <p className="muted" style={{ marginTop: 8 }}>Edits/deletes require supervisor or admin approval.</p>}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRow ? 'Edit Allocation Record' : 'New Allocation Record'}</h3>
            <form onSubmit={handleSave}>
              <div className="grid cols-2">
                <div className="field">
                  <label>Estate</label>
                  <select value={form.estate_id} onChange={(e) => setForm({ ...form, estate_id: e.target.value })} required>
                    <option value="">Select estate…</option>
                    {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div className="field"><label>House No</label><input value={form.house_no} onChange={(e) => setForm({ ...form, house_no: e.target.value })} /></div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label>Subscriber Name</label><input value={form.subscriber_name} onChange={(e) => setForm({ ...form, subscriber_name: e.target.value })} required /></div>
                <div className="field"><label>Property Type</label><input value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })} placeholder="e.g. 3BR, 4BR Fully" /></div>
                <div className="field"><label>Phone Number</label><input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} /></div>
              </div>

              <div className="section-label">Allocation Status <span className="muted" style={{ fontWeight: 400, textTransform: 'none' }}>(date optional — fill in later if you don't have it yet)</span></div>
              <div className="grid cols-2">
                <div className="field check-field"><input type="checkbox" checked={form.printed} onChange={(e) => setForm({ ...form, printed: e.target.checked })} /><label style={{ margin: 0 }}>Printed</label></div>
                <div className="field check-field"><input type="checkbox" checked={form.signed} onChange={(e) => setForm({ ...form, signed: e.target.checked })} /><label style={{ margin: 0 }}>Signed</label></div>
                <div className="field check-field"><input type="checkbox" checked={form.collected} onChange={(e) => setForm({ ...form, collected: e.target.checked })} /><label style={{ margin: 0 }}>Collected</label></div>
                <div className="field"><label>Collected By</label><input value={form.collected_by} onChange={(e) => setForm({ ...form, collected_by: e.target.value })} /></div>
                <div className="field"><label>Date Collected (optional)</label><input type="date" value={form.collected_date} onChange={(e) => setForm({ ...form, collected_date: e.target.value })} /></div>
              </div>

              {customFields.length > 0 && (
                <>
                  <div className="section-label">Additional Fields</div>
                  <CustomFieldInputs fields={customFields} values={customData} onChange={setCustomData} />
                </>
              )}

              <div className="field"><label>Remarks</label><textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Record'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {cooRow && (
        <div className="modal-overlay" onClick={() => setCooRow(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Record Change of Ownership</h3>
            <p className="muted">Current name on allocation: <b>{cooRow.subscriber_name}</b></p>
            <form onSubmit={handleCooSubmit}>
              <div className="field"><label>New Owner Name</label><input value={cooForm.new_owner} onChange={(e) => setCooForm({ ...cooForm, new_owner: e.target.value })} required /></div>
              <div className="field"><label>Reason for Change</label><input value={cooForm.reason} onChange={(e) => setCooForm({ ...cooForm, reason: e.target.value })} /></div>
              <div className="field"><label>New House No (if reissued)</label><input value={cooForm.new_allocation_no} onChange={(e) => setCooForm({ ...cooForm, new_allocation_no: e.target.value })} /></div>
              <div className="field"><label>Comments</label><textarea rows={2} value={cooForm.comments} onChange={(e) => setCooForm({ ...cooForm, comments: e.target.value })} /></div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setCooRow(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={cooSaving}>{cooSaving ? 'Saving…' : 'Record Change'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showColumns && <ManageColumnsModal tableName="allocation_records" onClose={() => setShowColumns(false)} onChanged={load} />}
      {showImport && (
        <BulkImportModal
          title="Bulk Import Allocations"
          tableName="allocation_records"
          fieldDefs={ALLOCATION_FIELD_DEFS}
          profile={profile}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}
    </div>
  );
}

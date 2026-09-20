import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fetchAllFrom } from '../lib/fetchAll';
import { useAuth } from '../lib/AuthContext';
import { submitOrApplyUpdate, submitOrApplyDelete } from '../lib/recordActions';
import { fetchCustomFields } from '../lib/customFields';
import { blankToNull } from '../lib/sanitize';
import ManageColumnsModal from './ManageColumnsModal';
import BulkImportModal from './BulkImportModal';
import { CustomFieldInputs, CustomFieldHeaders, CustomFieldCells } from './CustomFieldWidgets';

const BLANK = {
  subscriber_name: '', house_no: '', property_type: '',
  printed: false, signed: false, collected: false, collected_by: '', collected_date: '',
  phone_number: '', remarks: '',
};

export const ALLOCATION_FIELD_DEFS = [
  { key: 'house_no', label: 'House No', type: 'text', required: true, synonyms: ['house no', 'house number', 'allocation no', 'plot no'] },
  { key: 'subscriber_name', label: 'Subscriber Name', type: 'text', synonyms: ['subscriber', 'name'] },
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
  const { estateId } = useParams();
  const { profile, isSupervisorPlus, isAdmin } = useAuth();
  const [estate, setEstate] = useState(null);
  const [rows, setRows] = useState([]);
  const [customFields, setCustomFields] = useState([]);
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
  const [cooForm, setCooForm] = useState({
    new_owner: '', reason: '', new_allocation_no: '', comments: '',
    amount_paid: '', date_changed: '',
  });
  const [cooSaving, setCooSaving] = useState(false);
  const [cooFile, setCooFile] = useState(null);

  useEffect(() => { load(); }, [estateId]);

  async function load() {
    setLoading(true);
    const { data: estateData } = await supabase.from('estates').select('*').eq('id', estateId).single();
    setEstate(estateData || null);
    setCustomFields(await fetchCustomFields('allocation_records'));
    const data = await fetchAllFrom('allocation_records', (q) =>
      q.select('*').eq('estate_id', estateId).eq('is_deleted', false).order('created_at', { ascending: true })
    );
    setRows(data || []);
    setLoading(false);
  }

  const numbered = useMemo(() => rows.map((r, i) => ({ ...r, localSerial: i + 1 })), [rows]);

  const filtered = useMemo(() => {
    return numbered.filter((r) => {
      if (statusFilter === 'signed' && !r.signed) return false;
      if (statusFilter === 'collected' && !r.collected) return false;
      if (statusFilter === 'pending' && r.collected) return false;
      if (statusFilter === 'vacant' && r.subscriber_name) return false;
      const hay = `${r.subscriber_name || ''} ${r.house_no || ''} ${r.phone_number || ''}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
  }, [numbered, statusFilter, search]);

  const summary = useMemo(() => ({
    total: filtered.length,
    signed: filtered.filter((r) => r.signed).length,
    collected: filtered.filter((r) => r.collected).length,
    vacant: filtered.filter((r) => !r.subscriber_name).length,
  }), [filtered]);

  function openNew() { setEditingRow(null); setForm(BLANK); setCustomData({}); setError(''); setShowModal(true); }
  function openEdit(row) {
    setEditingRow(row);
    setForm({
      subscriber_name: row.subscriber_name || '', house_no: row.house_no || '',
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
    if (!form.house_no.trim() && !form.subscriber_name.trim()) {
      setError('Enter at least a House No or a Subscriber Name.');
      return;
    }
    setSaving(true);
    const payload = blankToNull({ ...form, custom_data: customData }, ['collected_date']);

    if (editingRow) {
      const { error, requiresApproval } = await submitOrApplyUpdate({ profile, tableName: 'allocation_records', recordId: editingRow.id, changes: payload });
      setSaving(false);
      if (error) { setError(error.message); return; }
      setShowModal(false);
      alert(requiresApproval ? 'Edit submitted for supervisor/admin approval.' : 'Record updated.');
      load();
      return;
    }
    const { error } = await supabase.from('allocation_records').insert({ ...payload, estate_id: estateId, created_by: profile.id });
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
    setCooForm({
      new_owner: '',
      reason: '',
      new_allocation_no: row.house_no || '',
      comments: '',
      amount_paid: '',
      date_changed: new Date().toISOString().slice(0, 10),
    });
    setCooFile(null);
    setError('');
  }

  async function handleCooSubmit(e) {
    e.preventDefault();
    setError('');
    if (!cooForm.new_owner.trim()) { setError('Enter the new owner name.'); return; }
    setCooSaving(true);
    const { data: logRow, error: logError } = await supabase.from('ownership_changes').insert({
      allocation_record_id: cooRow.id,
      previous_owner: cooRow.subscriber_name,
      new_owner: cooForm.new_owner.trim(),
      reason: cooForm.reason,
      new_allocation_no: cooForm.new_allocation_no,
      comments: cooForm.comments,
      estate_id: estateId,
      property_type: cooRow.property_type || null,
      amount_paid: Number(cooForm.amount_paid) || 0,
      date_changed: cooForm.date_changed || new Date().toISOString().slice(0, 10),
      created_by: profile.id,
    }).select('id').single();
    if (logError) { setError(logError.message); setCooSaving(false); return; }

    // Optional payment evidence upload linked to this COO
    if (cooFile && logRow?.id) {
      try {
        const { uploadDocument } = await import('../lib/documents');
        await uploadDocument({
          file: cooFile,
          description: 'COO payment evidence',
          uploadedBy: profile.id,
          linkedTable: 'ownership_changes',
          linkedRecordId: logRow.id,
          estateId,
          subscriberName: cooForm.new_owner.trim(),
        });
      } catch (err) {
        console.warn('COO evidence upload failed', err);
      }
    }

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

  async function handleClearEstate() {
    if (rows.length === 0) { alert('There are no allocation records to clear for this estate.'); return; }
    const ok = confirm(`This will remove all ${rows.length} allocation record(s) for ${estate?.name}. You would need to re-import to get them back. Continue?`);
    if (!ok) return;
    const typed = prompt('Type DELETE to confirm clearing all allocation records for this estate.');
    if (typed !== 'DELETE') { alert('Cancelled.'); return; }
    const { error } = await supabase.from('allocation_records').update({ is_deleted: true }).eq('estate_id', estateId).eq('is_deleted', false);
    if (error) { alert(error.message); return; }
    alert('All allocation records for this estate have been cleared. You can now re-import a clean file.');
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <Link to="/allocations" className="muted">&larr; All Estates</Link>
          <h2>Allocations — {estate?.name || '…'}</h2>
        </div>
        <div className="flex wrap">
          <button className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button className="btn btn-outline" onClick={() => setShowImport(true)}>Bulk Import from Excel</button>
          {isAdmin && <button className="btn btn-danger" onClick={handleClearEstate}>Clear All Records for This Estate</button>}
          <button className="btn btn-primary" onClick={openNew}>+ New Allocation</button>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="stat-card"><div className="value">{summary.total}</div><div className="label">Allocations Shown</div></div>
        <div className="stat-card blue"><div className="value">{summary.signed}</div><div className="label">Signed</div></div>
        <div className="stat-card gold"><div className="value">{summary.collected}</div><div className="label">Collected</div></div>
        <div className="stat-card grey"><div className="value">{summary.vacant}</div><div className="label">Vacant / Unallocated</div></div>
      </div>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 180 }}>
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="signed">Signed</option>
              <option value="collected">Collected</option>
              <option value="pending">Not Yet Collected</option>
              <option value="vacant">Vacant / Unallocated</option>
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
                <th>S/N</th><th>House No</th><th>Subscriber Name</th><th>Property Type</th>
                <th>Printed</th><th>Signed</th><th>Collected</th><th>Collected By</th><th>Date Collected</th><th>Phone</th>
                <CustomFieldHeaders fields={customFields} />
                <th>Remarks</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.localSerial}</td>
                  <td>{r.house_no}</td>
                  <td>{r.subscriber_name ? <Link to={`/subscriber/${estateId}/${encodeURIComponent(r.subscriber_name)}`}>{r.subscriber_name}</Link> : <span className="tag rejected">Vacant</span>}</td>
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
                      {r.subscriber_name && <button className="btn btn-outline btn-sm" onClick={() => openCoo(r)}>Record COO</button>}
                      <Link className="btn btn-outline btn-sm" to={`/documents?linkedTable=allocation_records&linkedRecordId=${r.id}`}>Docs</Link>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={12 + customFields.length} className="empty-state">No allocation records found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {!isSupervisorPlus && <p className="muted" style={{ marginTop: 8 }}>Edits/deletes require supervisor or admin approval.</p>}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRow ? 'Edit Allocation Record' : `New Allocation — ${estate?.name || ''}`}</h3>
            <form onSubmit={handleSave}>
              <div className="grid cols-2">
                <div className="field" style={{ gridColumn: 'span 2' }}><label>House No</label><input value={form.house_no} onChange={(e) => setForm({ ...form, house_no: e.target.value })} /></div>
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label>Subscriber Name <span className="muted" style={{ fontWeight: 400 }}>(leave blank if not yet allocated to anyone — e.g. defect, bad structure, erosion, hillside location)</span></label>
                  <input value={form.subscriber_name} onChange={(e) => setForm({ ...form, subscriber_name: e.target.value })} />
                </div>
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
              <div className="field">
                <label>New Owner Name</label>
                <input value={cooForm.new_owner} onChange={(e) => setCooForm({ ...cooForm, new_owner: e.target.value })} required />
              </div>
              <div className="field">
                <label>Reason for Change</label>
                <input value={cooForm.reason} onChange={(e) => setCooForm({ ...cooForm, reason: e.target.value })} />
              </div>
              <div className="field">
                <label>New House No (if reissued)</label>
                <input value={cooForm.new_allocation_no} onChange={(e) => setCooForm({ ...cooForm, new_allocation_no: e.target.value })} />
              </div>
              <div className="field">
                <label>COO Fee Paid (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  value={cooForm.amount_paid}
                  onChange={(e) => setCooForm({ ...cooForm, amount_paid: e.target.value })}
                  placeholder="0 if not yet paid"
                />
              </div>
              <div className="field">
                <label>Date of Change</label>
                <input
                  type="date"
                  value={cooForm.date_changed}
                  onChange={(e) => setCooForm({ ...cooForm, date_changed: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Payment evidence (optional)</label>
                <input type="file" onChange={(e) => setCooFile(e.target.files?.[0] || null)} />
              </div>
              <div className="field">
                <label>Comments</label>
                <textarea rows={2} value={cooForm.comments} onChange={(e) => setCooForm({ ...cooForm, comments: e.target.value })} />
              </div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setCooRow(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={cooSaving}>
                  {cooSaving ? 'Saving…' : 'Record Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showColumns && <ManageColumnsModal tableName="allocation_records" onClose={() => setShowColumns(false)} onChanged={load} />}
      {showImport && (
        <BulkImportModal
          title={`Bulk Import Allocations — ${estate?.name || ''}`}
          tableName="allocation_records"
          fieldDefs={ALLOCATION_FIELD_DEFS}
          presetEstateId={estateId}
          profile={profile}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}
    </div>
  );
}

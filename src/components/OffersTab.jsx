import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { submitOrApplyUpdate, submitOrApplyDelete } from '../lib/recordActions';
import { fetchCustomFields } from '../lib/customFields';
import { blankToNull } from '../lib/sanitize';
import ManageColumnsModal from './ManageColumnsModal';
import BulkImportModal from './BulkImportModal';
import { CustomFieldInputs, CustomFieldHeaders, CustomFieldCells } from './CustomFieldWidgets';

const BLANK = {
  subscriber_name: '', form_no: '', property_type: '', phone_number: '', email_address: '',
  offer_printed: false, offer_collected: false, offer_collected_by: '', offer_collected_date: '',
  amount_paid: '', comment: '', remarks: '',
};

export const OFFER_FIELD_DEFS = [
  { key: 'subscriber_name', label: 'Subscriber Name', type: 'text', required: true, synonyms: ['subscriber', 'subscriber name', 'name'] },
  { key: 'form_no', label: 'Form No / PON', type: 'text', synonyms: ['form no', 'form number', 'pon'] },
  { key: 'property_type', label: 'Property Type', type: 'text', synonyms: ['property type', 'type'] },
  { key: 'phone_number', label: 'Phone Number', type: 'text', synonyms: ['phone number', 'phone', 'tel', 'telephone'] },
  { key: 'email_address', label: 'Email Address', type: 'text', synonyms: ['email address', 'email'] },
  { key: 'offer_printed', label: 'Offer Printed', type: 'checkbox', synonyms: ['offer printed', 'printed'] },
  { key: 'offer_collected', label: 'Offer Collected', type: 'checkbox', synonyms: ['offer collected', 'collected'] },
  { key: 'offer_collected_by', label: 'Offer Collected By', type: 'text', synonyms: ['offer collected by', 'collected by', 'offer xcollected by'] },
  { key: 'offer_collected_date', label: 'Offer Collected On', type: 'date', synonyms: ['offer collected on', 'collected on', 'date collected'] },
  { key: 'amount_paid', label: 'Amount Paid', type: 'number', synonyms: ['amount paid', 'amount'] },
  { key: 'comment', label: 'Comment', type: 'text', synonyms: ['comment', 'comments'] },
  { key: 'remarks', label: 'Remarks', type: 'text', synonyms: ['remarks'] },
];

export default function OffersTab() {
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
  const [cooForm, setCooForm] = useState({ new_owner: '', reason: '', new_pon: '', comments: '' });
  const [cooSaving, setCooSaving] = useState(false);

  useEffect(() => { load(); }, [estateId]);

  async function load() {
    setLoading(true);
    const { data: estateData } = await supabase.from('estates').select('*').eq('id', estateId).single();
    setEstate(estateData || null);
    setCustomFields(await fetchCustomFields('offers'));
    const { data } = await supabase
      .from('offers')
      .select('*')
      .eq('estate_id', estateId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    setRows(data || []);
    setLoading(false);
  }

  // local, per-estate serial numbers (1, 2, 3…) rather than a global row id
  const numbered = useMemo(() => rows.map((r, i) => ({ ...r, localSerial: i + 1 })), [rows]);

  const filtered = useMemo(() => {
    return numbered.filter((r) => {
      if (statusFilter === 'printed' && !r.offer_printed) return false;
      if (statusFilter === 'collected' && !r.offer_collected) return false;
      if (statusFilter === 'pending' && r.offer_collected) return false;
      const hay = `${r.subscriber_name} ${r.form_no || ''} ${r.phone_number || ''} ${r.email_address || ''}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
  }, [numbered, statusFilter, search]);

  const summary = useMemo(() => ({
    total: filtered.length,
    printed: filtered.filter((r) => r.offer_printed).length,
    collected: filtered.filter((r) => r.offer_collected).length,
    totalPaid: filtered.reduce((s, r) => s + Number(r.amount_paid || 0), 0),
  }), [filtered]);

  function openNew() { setEditingRow(null); setForm(BLANK); setCustomData({}); setError(''); setShowModal(true); }
  function openEdit(row) {
    setEditingRow(row);
    setForm({
      subscriber_name: row.subscriber_name || '', form_no: row.form_no || '',
      property_type: row.property_type || '', phone_number: row.phone_number || '', email_address: row.email_address || '',
      offer_printed: row.offer_printed, offer_collected: row.offer_collected,
      offer_collected_by: row.offer_collected_by || '', offer_collected_date: row.offer_collected_date || '',
      amount_paid: row.amount_paid ?? '', comment: row.comment || '', remarks: row.remarks || '',
    });
    setCustomData(row.custom_data || {});
    setError(''); setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!form.subscriber_name.trim()) { setError('Subscriber Name is required.'); return; }
    setSaving(true);
    const payload = blankToNull({ ...form, amount_paid: Number(form.amount_paid) || 0, custom_data: customData }, ['offer_collected_date']);

    if (editingRow) {
      const { error, requiresApproval } = await submitOrApplyUpdate({ profile, tableName: 'offers', recordId: editingRow.id, changes: payload });
      setSaving(false);
      if (error) { setError(error.message); return; }
      setShowModal(false);
      alert(requiresApproval ? 'Edit submitted for supervisor/admin approval.' : 'Record updated.');
      load();
      return;
    }
    const { error } = await supabase.from('offers').insert({ ...payload, estate_id: estateId, created_by: profile.id });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setShowModal(false);
    load();
  }

  async function handleDelete(row) {
    const reason = prompt('Reason for deleting this record (required):');
    if (!reason) return;
    const { error, requiresApproval } = await submitOrApplyDelete({ profile, tableName: 'offers', recordId: row.id, reason });
    if (error) { alert(error.message); return; }
    alert(requiresApproval ? 'Delete request submitted for approval.' : 'Record deleted.');
    load();
  }

  function openCoo(row) {
    setCooRow(row);
    setCooForm({ new_owner: '', reason: '', new_pon: row.form_no || '', comments: '' });
    setError('');
  }

  async function handleCooSubmit(e) {
    e.preventDefault();
    setError('');
    if (!cooForm.new_owner.trim()) { setError('Enter the new owner name.'); return; }
    setCooSaving(true);
    const { error: logError } = await supabase.from('ownership_changes').insert({
      offer_id: cooRow.id, previous_owner: cooRow.subscriber_name, new_owner: cooForm.new_owner.trim(),
      reason: cooForm.reason, new_pon: cooForm.new_pon, comments: cooForm.comments, created_by: profile.id,
    });
    if (logError) { setError(logError.message); setCooSaving(false); return; }
    const { error: updError, requiresApproval } = await submitOrApplyUpdate({
      profile, tableName: 'offers', recordId: cooRow.id,
      changes: { subscriber_name: cooForm.new_owner.trim(), form_no: cooForm.new_pon },
      reason: `Change of Ownership: ${cooForm.reason || ''}`,
    });
    setCooSaving(false);
    if (updError) { setError(updError.message); return; }
    setCooRow(null);
    alert(requiresApproval ? 'Ownership change logged; name update sent for approval.' : 'Ownership change recorded.');
    load();
  }

  async function handleClearEstate() {
    if (rows.length === 0) { alert('There are no offer records to clear for this estate.'); return; }
    const ok = confirm(`This will remove all ${rows.length} offer record(s) for ${estate?.name}. You would need to re-import to get them back. Continue?`);
    if (!ok) return;
    const typed = prompt('Type DELETE to confirm clearing all offer records for this estate.');
    if (typed !== 'DELETE') { alert('Cancelled.'); return; }
    const { error } = await supabase.from('offers').update({ is_deleted: true }).eq('estate_id', estateId).eq('is_deleted', false);
    if (error) { alert(error.message); return; }
    alert('All offer records for this estate have been cleared. You can now re-import a clean file.');
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <Link to="/offers" className="muted">&larr; All Estates</Link>
          <h2>Offers — {estate?.name || '…'}</h2>
        </div>
        <div className="flex wrap">
          <button className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button className="btn btn-outline" onClick={() => setShowImport(true)}>Bulk Import from Excel</button>
          {isAdmin && <button className="btn btn-danger" onClick={handleClearEstate}>Clear All Records for This Estate</button>}
          <button className="btn btn-primary" onClick={openNew}>+ New Offer</button>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="stat-card"><div className="value">{summary.total}</div><div className="label">Offers Shown</div></div>
        <div className="stat-card blue"><div className="value">{summary.printed}</div><div className="label">Printed</div></div>
        <div className="stat-card gold"><div className="value">{summary.collected}</div><div className="label">Collected</div></div>
        <div className="stat-card grey"><div className="value">₦{summary.totalPaid.toLocaleString()}</div><div className="label">Total Amount Paid</div></div>
      </div>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 180 }}>
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="printed">Printed</option>
              <option value="collected">Collected</option>
              <option value="pending">Not Yet Collected</option>
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, form no, phone, email…" />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>S/N</th><th>Subscriber Name</th><th>Form No</th><th>Property Type</th>
                <th>Phone</th><th>Email</th><th>Printed</th><th>Collected</th><th>Collected By</th><th>Collected On</th>
                <th>Amount Paid</th>
                <CustomFieldHeaders fields={customFields} />
                <th>Comment</th><th>Remarks</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.localSerial}</td>
                  <td>{r.subscriber_name}</td>
                  <td>{r.form_no}</td>
                  <td>{r.property_type}</td>
                  <td>{r.phone_number}</td>
                  <td>{r.email_address}</td>
                  <td>{r.offer_printed ? '✓' : ''}</td>
                  <td>{r.offer_collected ? '✓' : ''}</td>
                  <td>{r.offer_collected_by}</td>
                  <td>{r.offer_collected_date}</td>
                  <td className="right">{Number(r.amount_paid || 0).toLocaleString()}</td>
                  <CustomFieldCells fields={customFields} values={r.custom_data} />
                  <td>{r.comment}</td>
                  <td>{r.remarks}</td>
                  <td>
                    <div className="flex wrap">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-outline btn-sm" onClick={() => openCoo(r)}>Record COO</button>
                      <Link className="btn btn-outline btn-sm" to={`/documents?linkedTable=offers&linkedRecordId=${r.id}`}>Docs</Link>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={15 + customFields.length} className="empty-state">No offer records found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {!isSupervisorPlus && <p className="muted" style={{ marginTop: 8 }}>Edits/deletes require supervisor or admin approval.</p>}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRow ? 'Edit Offer Record' : `New Offer — ${estate?.name || ''}`}</h3>
            <form onSubmit={handleSave}>
              <div className="grid cols-2">
                <div className="field" style={{ gridColumn: 'span 2' }}><label>Subscriber Name</label><input value={form.subscriber_name} onChange={(e) => setForm({ ...form, subscriber_name: e.target.value })} required /></div>
                <div className="field"><label>Property Type</label><input value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })} placeholder="e.g. 3BR, 4BR Fully" /></div>
                <div className="field"><label>Form No / PON</label><input value={form.form_no} onChange={(e) => setForm({ ...form, form_no: e.target.value })} /></div>
                <div className="field"><label>Phone Number</label><input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} /></div>
                <div className="field"><label>Email Address</label><input type="email" value={form.email_address} onChange={(e) => setForm({ ...form, email_address: e.target.value })} /></div>
                <div className="field"><label>Amount Paid (₦)</label><input type="number" step="0.01" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} /></div>
              </div>

              <div className="section-label">Offer Status <span className="muted" style={{ fontWeight: 400, textTransform: 'none' }}>(dates optional — fill in later if you don't have them yet)</span></div>
              <div className="grid cols-2">
                <div className="field check-field"><input type="checkbox" checked={form.offer_printed} onChange={(e) => setForm({ ...form, offer_printed: e.target.checked })} /><label style={{ margin: 0 }}>Offer Printed</label></div>
                <div className="field check-field"><input type="checkbox" checked={form.offer_collected} onChange={(e) => setForm({ ...form, offer_collected: e.target.checked })} /><label style={{ margin: 0 }}>Offer Collected</label></div>
                <div className="field"><label>Offer Collected By</label><input value={form.offer_collected_by} onChange={(e) => setForm({ ...form, offer_collected_by: e.target.value })} /></div>
                <div className="field"><label>Offer Collected On (optional)</label><input type="date" value={form.offer_collected_date} onChange={(e) => setForm({ ...form, offer_collected_date: e.target.value })} /></div>
              </div>

              {customFields.length > 0 && (
                <>
                  <div className="section-label">Additional Fields</div>
                  <CustomFieldInputs fields={customFields} values={customData} onChange={setCustomData} />
                </>
              )}

              <div className="field"><label>Comment</label><input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></div>
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
            <p className="muted">Current name on offer: <b>{cooRow.subscriber_name}</b></p>
            <form onSubmit={handleCooSubmit}>
              <div className="field"><label>New Owner Name</label><input value={cooForm.new_owner} onChange={(e) => setCooForm({ ...cooForm, new_owner: e.target.value })} required /></div>
              <div className="field"><label>Reason for Change</label><input value={cooForm.reason} onChange={(e) => setCooForm({ ...cooForm, reason: e.target.value })} /></div>
              <div className="field"><label>New Form No / PON (if reissued)</label><input value={cooForm.new_pon} onChange={(e) => setCooForm({ ...cooForm, new_pon: e.target.value })} /></div>
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

      {showColumns && <ManageColumnsModal tableName="offers" onClose={() => setShowColumns(false)} onChanged={load} />}
      {showImport && (
        <BulkImportModal
          title={`Bulk Import Offers — ${estate?.name || ''}`}
          tableName="offers"
          fieldDefs={OFFER_FIELD_DEFS}
          presetEstateId={estateId}
          profile={profile}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}
    </div>
  );
}

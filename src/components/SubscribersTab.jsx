import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { submitOrApplyUpdate, submitOrApplyDelete } from '../lib/recordActions';
import { fetchCustomFields } from '../lib/customFields';
import ManageColumnsModal from './ManageColumnsModal';
import { CustomFieldInputs, CustomFieldHeaders, CustomFieldCells } from './CustomFieldWidgets';

const BLANK = {
  estate_id: '', subscriber_name: '', pon: '', property_type: '', phone_number: '', email_address: '',
  offer_made: false, offer_printed: false, offer_collected: false, offer_collected_by: '',
  offer_collected_date: '', date_offer_signed: '',
  allocation_made: false, allocation_no: '', allocation_collected_by: '', allocation_collected_date: '', date_allocation_signed: '',
  amount_paid_property: '', amount_paid_infrastructure: '', legal_tdp: '', comments: '', remarks: '',
};

export default function SubscribersTab() {
  const { profile, isSupervisorPlus, isAdmin } = useAuth();
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [propertyTypes, setPropertyTypes] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [estateFilter, setEstateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '', 'offer', 'allocated', 'both', 'none'
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [customData, setCustomData] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // COO modal
  const [cooRow, setCooRow] = useState(null);
  const [cooForm, setCooForm] = useState({ new_owner: '', reason: '', new_pon: '', new_allocation_no: '', comments: '' });
  const [cooSaving, setCooSaving] = useState(false);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (form.estate_id) loadPropertyTypes(form.estate_id); }, [form.estate_id]);

  async function loadPropertyTypes(estateId) {
    const { data } = await supabase.from('estate_property_types').select('*').eq('estate_id', estateId);
    setPropertyTypes(data || []);
  }

  async function load() {
    setLoading(true);
    const { data: estatesData } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(estatesData || []);
    setCustomFields(await fetchCustomFields('subscribers'));
    const { data } = await supabase
      .from('subscribers')
      .select('*, estates(name)')
      .eq('is_deleted', false)
      .order('serial_no', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (estateFilter && r.estate_id !== estateFilter) return false;
      if (statusFilter === 'offer' && !r.offer_made) return false;
      if (statusFilter === 'allocated' && !r.allocation_made) return false;
      if (statusFilter === 'both' && !(r.offer_made && r.allocation_made)) return false;
      if (statusFilter === 'none' && (r.offer_made || r.allocation_made)) return false;
      const hay = `${r.subscriber_name} ${r.pon || ''} ${r.allocation_no || ''} ${r.phone_number || ''} ${r.email_address || ''}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
  }, [rows, estateFilter, statusFilter, search]);

  const summary = useMemo(() => ({
    total: filtered.length,
    offers: filtered.filter((r) => r.offer_made).length,
    allocated: filtered.filter((r) => r.allocation_made).length,
    totalProperty: filtered.reduce((s, r) => s + Number(r.amount_paid_property || 0), 0),
    totalInfra: filtered.reduce((s, r) => s + Number(r.amount_paid_infrastructure || 0), 0),
  }), [filtered]);

  function openNew() {
    setEditingRow(null);
    setForm(BLANK);
    setCustomData({});
    setError('');
    setShowModal(true);
  }

  function openEdit(row) {
    setEditingRow(row);
    setForm({
      estate_id: row.estate_id, subscriber_name: row.subscriber_name || '', pon: row.pon || '',
      property_type: row.property_type || '', phone_number: row.phone_number || '', email_address: row.email_address || '',
      offer_made: row.offer_made, offer_printed: row.offer_printed, offer_collected: row.offer_collected,
      offer_collected_by: row.offer_collected_by || '', offer_collected_date: row.offer_collected_date || '',
      date_offer_signed: row.date_offer_signed || '',
      allocation_made: row.allocation_made, allocation_no: row.allocation_no || '',
      allocation_collected_by: row.allocation_collected_by || '', allocation_collected_date: row.allocation_collected_date || '',
      date_allocation_signed: row.date_allocation_signed || '',
      amount_paid_property: row.amount_paid_property ?? '', amount_paid_infrastructure: row.amount_paid_infrastructure ?? '',
      legal_tdp: row.legal_tdp || '', comments: row.comments || '', remarks: row.remarks || '',
    });
    setCustomData(row.custom_data || {});
    setError('');
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!form.estate_id || !form.subscriber_name.trim()) {
      setError('Estate and Subscriber Name are required.');
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      amount_paid_property: Number(form.amount_paid_property) || 0,
      amount_paid_infrastructure: Number(form.amount_paid_infrastructure) || 0,
      custom_data: customData,
    };

    if (editingRow) {
      const { error, requiresApproval } = await submitOrApplyUpdate({
        profile, tableName: 'subscribers', recordId: editingRow.id, changes: payload,
      });
      setSaving(false);
      if (error) { setError(error.message); return; }
      setShowModal(false);
      alert(requiresApproval ? 'Edit submitted for supervisor/admin approval.' : 'Record updated.');
      load();
      return;
    }

    const { error } = await supabase.from('subscribers').insert({ ...payload, created_by: profile.id });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setShowModal(false);
    load();
  }

  async function handleDelete(row) {
    const reason = prompt('Reason for deleting this record (required):');
    if (!reason) return;
    const { error, requiresApproval } = await submitOrApplyDelete({ profile, tableName: 'subscribers', recordId: row.id, reason });
    if (error) { alert(error.message); return; }
    alert(requiresApproval ? 'Delete request submitted for approval.' : 'Record deleted.');
    load();
  }

  function openCoo(row) {
    setCooRow(row);
    setCooForm({ new_owner: '', reason: '', new_pon: row.pon || '', new_allocation_no: row.allocation_no || '', comments: '' });
    setError('');
  }

  async function handleCooSubmit(e) {
    e.preventDefault();
    setError('');
    if (!cooForm.new_owner.trim()) { setError('Enter the new owner name.'); return; }
    setCooSaving(true);

    const { error: logError } = await supabase.from('ownership_changes').insert({
      subscriber_id: cooRow.id,
      previous_owner: cooRow.subscriber_name,
      new_owner: cooForm.new_owner.trim(),
      reason: cooForm.reason,
      new_pon: cooForm.new_pon,
      new_allocation_no: cooForm.new_allocation_no,
      comments: cooForm.comments,
      created_by: profile.id,
    });
    if (logError) { setError(logError.message); setCooSaving(false); return; }

    const { error: updError, requiresApproval } = await submitOrApplyUpdate({
      profile, tableName: 'subscribers', recordId: cooRow.id,
      changes: { subscriber_name: cooForm.new_owner.trim(), pon: cooForm.new_pon, allocation_no: cooForm.new_allocation_no },
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
        <h2>Subscribers — Offer &amp; Allocation Register</h2>
        <div className="flex">
          <button className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button className="btn btn-primary" onClick={openNew}>+ New Subscriber</button>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="stat-card"><div className="value">{summary.total}</div><div className="label">Subscribers Shown</div></div>
        <div className="stat-card blue"><div className="value">{summary.offers}</div><div className="label">Offers Made</div></div>
        <div className="stat-card gold"><div className="value">{summary.allocated}</div><div className="label">Allocations Made</div></div>
        <div className="stat-card grey"><div className="value">₦{(summary.totalProperty + summary.totalInfra).toLocaleString()}</div><div className="label">Total Amount Paid</div></div>
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
              <option value="offer">Offer Made</option>
              <option value="allocated">Allocated</option>
              <option value="both">Offer + Allocated</option>
              <option value="none">Neither Yet</option>
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, PON, allocation no, phone, email…" />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>S/N</th><th>Estate</th><th>Subscriber Name</th><th>PON</th><th>Property Type</th>
                <th>Offer</th><th>Allocated</th><th>Allocation No</th><th>Phone</th><th>Email</th>
                <th>Offer Printed</th><th>Offer Collected</th><th>Offer Collected By</th><th>Allocation Collected By</th>
                <th>Amt Paid (Property)</th><th>Amt Paid (Infra)</th><th>Legal/TDP</th>
                <CustomFieldHeaders fields={customFields} />
                <th>Comment</th><th>Remarks</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.serial_no}</td>
                  <td>{r.estates?.name}</td>
                  <td>{r.subscriber_name}</td>
                  <td>{r.pon}</td>
                  <td>{r.property_type}</td>
                  <td>{r.offer_made ? '✓' : ''}</td>
                  <td>{r.allocation_made ? '✓' : ''}</td>
                  <td>{r.allocation_no}</td>
                  <td>{r.phone_number}</td>
                  <td>{r.email_address}</td>
                  <td>{r.offer_printed ? 'P' : ''}</td>
                  <td>{r.offer_collected ? 'C' : ''}</td>
                  <td>{r.offer_collected_by}</td>
                  <td>{r.allocation_collected_by}</td>
                  <td className="right">{Number(r.amount_paid_property || 0).toLocaleString()}</td>
                  <td className="right">{Number(r.amount_paid_infrastructure || 0).toLocaleString()}</td>
                  <td>{r.legal_tdp}</td>
                  <CustomFieldCells fields={customFields} values={r.custom_data} />
                  <td>{r.comments}</td>
                  <td>{r.remarks}</td>
                  <td>
                    <div className="flex wrap">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-outline btn-sm" onClick={() => openCoo(r)}>Record COO</button>
                      <Link className="btn btn-outline btn-sm" to={`/documents?linkedTable=subscribers&linkedRecordId=${r.id}`}>Docs</Link>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={20 + customFields.length} className="empty-state">No subscriber records found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {!isSupervisorPlus && (
        <p className="muted" style={{ marginTop: 8 }}>
          Note: as a standard user, edits and deletes you make are sent to your supervisor/admin for approval before they take effect.
        </p>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRow ? 'Edit Subscriber Record' : 'New Subscriber Record'}</h3>
            <form onSubmit={handleSave}>
              <div className="grid cols-2">
                <div className="field">
                  <label>Estate</label>
                  <select value={form.estate_id} onChange={(e) => setForm({ ...form, estate_id: e.target.value })} required>
                    <option value="">Select estate…</option>
                    {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Property Type</label>
                  {propertyTypes.length > 0 ? (
                    <select value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })}>
                      <option value="">Select…</option>
                      {propertyTypes.map((pt) => <option key={pt.id} value={pt.property_type}>{pt.property_type}</option>)}
                    </select>
                  ) : (
                    <input value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })} placeholder="e.g. 3br, 500sqm" />
                  )}
                </div>
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label>Subscriber Name</label>
                  <input value={form.subscriber_name} onChange={(e) => setForm({ ...form, subscriber_name: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Phone Number</label>
                  <input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
                </div>
                <div className="field">
                  <label>Email Address</label>
                  <input type="email" value={form.email_address} onChange={(e) => setForm({ ...form, email_address: e.target.value })} />
                </div>
              </div>

              <div className="section-label">Provisional Offer</div>
              <div className="grid cols-2">
                <div className="field"><label>PON (Provisional Offer No)</label><input value={form.pon} onChange={(e) => setForm({ ...form, pon: e.target.value })} /></div>
                <div className="field"><label>Date Offer Signed</label><input type="date" value={form.date_offer_signed} onChange={(e) => setForm({ ...form, date_offer_signed: e.target.value })} /></div>
                <div className="field check-field"><input type="checkbox" checked={form.offer_made} onChange={(e) => setForm({ ...form, offer_made: e.target.checked })} /><label style={{ margin: 0 }}>Offer Made</label></div>
                <div className="field check-field"><input type="checkbox" checked={form.offer_printed} onChange={(e) => setForm({ ...form, offer_printed: e.target.checked })} /><label style={{ margin: 0 }}>Offer Printed</label></div>
                <div className="field check-field"><input type="checkbox" checked={form.offer_collected} onChange={(e) => setForm({ ...form, offer_collected: e.target.checked })} /><label style={{ margin: 0 }}>Offer Collected</label></div>
                <div className="field"><label>Offer Collected By</label><input value={form.offer_collected_by} onChange={(e) => setForm({ ...form, offer_collected_by: e.target.value })} /></div>
                <div className="field"><label>Date Offer Collected</label><input type="date" value={form.offer_collected_date} onChange={(e) => setForm({ ...form, offer_collected_date: e.target.value })} /></div>
              </div>

              <div className="section-label">Final Allocation</div>
              <div className="grid cols-2">
                <div className="field"><label>Allocation Number</label><input value={form.allocation_no} onChange={(e) => setForm({ ...form, allocation_no: e.target.value })} /></div>
                <div className="field"><label>Date Allocation Signed</label><input type="date" value={form.date_allocation_signed} onChange={(e) => setForm({ ...form, date_allocation_signed: e.target.value })} /></div>
                <div className="field check-field"><input type="checkbox" checked={form.allocation_made} onChange={(e) => setForm({ ...form, allocation_made: e.target.checked })} /><label style={{ margin: 0 }}>Allocation Made</label></div>
                <div className="field"><label>Allocation Collected By</label><input value={form.allocation_collected_by} onChange={(e) => setForm({ ...form, allocation_collected_by: e.target.value })} /></div>
                <div className="field"><label>Date Allocation Collected</label><input type="date" value={form.allocation_collected_date} onChange={(e) => setForm({ ...form, allocation_collected_date: e.target.value })} /></div>
              </div>

              <div className="section-label">Payments &amp; Legal</div>
              <div className="grid cols-2">
                <div className="field"><label>Amount Paid — Property (₦)</label><input type="number" step="0.01" value={form.amount_paid_property} onChange={(e) => setForm({ ...form, amount_paid_property: e.target.value })} /></div>
                <div className="field"><label>Amount Paid — Infrastructure (₦)</label><input type="number" step="0.01" value={form.amount_paid_infrastructure} onChange={(e) => setForm({ ...form, amount_paid_infrastructure: e.target.value })} /></div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label>Legal / TDP</label><input value={form.legal_tdp} onChange={(e) => setForm({ ...form, legal_tdp: e.target.value })} /></div>
              </div>

              {customFields.length > 0 && (
                <>
                  <div className="section-label">Additional Fields</div>
                  <CustomFieldInputs fields={customFields} values={customData} onChange={setCustomData} />
                </>
              )}

              <div className="field"><label>Comment</label><input value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} /></div>
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
            <p className="muted">Current owner: <b>{cooRow.subscriber_name}</b> · {cooRow.estates?.name}</p>
            <form onSubmit={handleCooSubmit}>
              <div className="field"><label>New Owner Name</label><input value={cooForm.new_owner} onChange={(e) => setCooForm({ ...cooForm, new_owner: e.target.value })} required /></div>
              <div className="field"><label>Reason for Change</label><input value={cooForm.reason} onChange={(e) => setCooForm({ ...cooForm, reason: e.target.value })} /></div>
              <div className="grid cols-2">
                <div className="field"><label>New PON (if reissued)</label><input value={cooForm.new_pon} onChange={(e) => setCooForm({ ...cooForm, new_pon: e.target.value })} /></div>
                <div className="field"><label>New Allocation No (if reissued)</label><input value={cooForm.new_allocation_no} onChange={(e) => setCooForm({ ...cooForm, new_allocation_no: e.target.value })} /></div>
              </div>
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

      {showColumns && (
        <ManageColumnsModal tableName="subscribers" onClose={() => setShowColumns(false)} onChanged={load} />
      )}
    </div>
  );
}

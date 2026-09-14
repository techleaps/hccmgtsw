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
  subscriber_name: '', property_type: '', payment_type: 'property', amount: '',
  date_paid: '', payment_reference: '', remarks: '',
};

const PAYMENT_TYPES = [
  { value: 'property', label: 'Property' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'legal_tdp', label: 'Legal / TDP' },
  { value: 'other', label: 'Other' },
];

export const PAYMENT_FIELD_DEFS = [
  { key: 'subscriber_name', label: 'Subscriber Name', type: 'text', required: true,
    synonyms: ['names', 'name', 'subscriber', 'subscriber name', 'full name'] },
  { key: 'property_type', label: 'Property Type', type: 'text',
    synonyms: ['property type', 'type', 'house type', 'unit type'] },
  { key: 'payment_type', label: 'Payment Type (Property/Infrastructure/Legal_tdp/Other)', type: 'text',
    synonyms: ['payment type', 'fee type', 'category'] },
  { key: 'amount', label: 'Amount / Total Amount Paid', type: 'number', required: true,
    synonyms: ['total amount paid', 'amount paid', 'total paid', 'amount', 'sum paid'] },
  { key: 'date_paid', label: 'Date Paid', type: 'date',
    synonyms: ['date paid', 'payment date', 'date'] },
  { key: 'payment_reference', label: 'Reference / Teller No / Receipt No', type: 'text',
    synonyms: ['receipt no', 'receipt number', 'teller no', 'reference', 'payment reference', 'ref no'] },
  { key: 'remarks', label: 'Remarks', type: 'text',
    synonyms: ['remarks', 'comment', 'comments', 'note', 'notes'] },
];

function normalizePaymentType(v) {
  const s = String(v || '').toLowerCase().trim();
  // Empty / missing Payment Type column (common on summary Excel sheets) → treat as Property
  if (!s) return 'property';
  if (s.includes('infra')) return 'infrastructure';
  if (s.includes('legal') || s.includes('tdp')) return 'legal_tdp';
  if (s.includes('prop')) return 'property';
  if (['property', 'infrastructure', 'legal_tdp', 'other'].includes(s)) return s;
  return 'other';
}

export default function PaymentsTab() {
  const { estateId } = useParams();
  const { profile, isSupervisorPlus, isAdmin } = useAuth();
  const [estate, setEstate] = useState(null);
  const [rows, setRows] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [typeFilter, setTypeFilter] = useState('');
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

  useEffect(() => { load(); }, [estateId]);

  async function load() {
    setLoading(true);
    const { data: estateData } = await supabase.from('estates').select('*').eq('id', estateId).single();
    setEstate(estateData || null);
    setCustomFields(await fetchCustomFields('payments'));
    const { data } = await supabase
      .from('payments')
      .select('*')
      .eq('estate_id', estateId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    setRows(data || []);
    setLoading(false);
  }

  const numbered = useMemo(() => rows.map((r, i) => ({ ...r, localSerial: i + 1 })), [rows]);

  const filtered = useMemo(() => {
    return numbered.filter((r) => {
      if (typeFilter && r.payment_type !== typeFilter) return false;
      const hay = `${r.subscriber_name} ${r.payment_reference || ''}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
  }, [numbered, typeFilter, search]);

  const summary = useMemo(() => {
    const byType = {};
    filtered.forEach((r) => { byType[r.payment_type] = (byType[r.payment_type] || 0) + Number(r.amount || 0); });
    return {
      total: filtered.length,
      totalAmount: filtered.reduce((s, r) => s + Number(r.amount || 0), 0),
      byType,
    };
  }, [filtered]);

  function openNew() { setEditingRow(null); setForm(BLANK); setCustomData({}); setError(''); setShowModal(true); }
  function openEdit(row) {
    setEditingRow(row);
    setForm({
      subscriber_name: row.subscriber_name || '', property_type: row.property_type || '',
      payment_type: row.payment_type || 'property', amount: row.amount ?? '',
      date_paid: row.date_paid || '', payment_reference: row.payment_reference || '', remarks: row.remarks || '',
    });
    setCustomData(row.custom_data || {});
    setError(''); setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!form.subscriber_name.trim()) { setError('Subscriber Name is required.'); return; }
    setSaving(true);
    const payload = blankToNull({ ...form, amount: Number(form.amount) || 0, custom_data: customData }, ['date_paid']);

    if (editingRow) {
      const { error, requiresApproval } = await submitOrApplyUpdate({ profile, tableName: 'payments', recordId: editingRow.id, changes: payload });
      setSaving(false);
      if (error) { setError(error.message); return; }
      setShowModal(false);
      alert(requiresApproval ? 'Edit submitted for supervisor/admin approval.' : 'Record updated.');
      load();
      return;
    }
    const { error } = await supabase.from('payments').insert({ ...payload, estate_id: estateId, created_by: profile.id });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setShowModal(false);
    load();
  }

  async function handleDelete(row) {
    const reason = prompt('Reason for deleting this record (required):');
    if (!reason) return;
    const { error, requiresApproval } = await submitOrApplyDelete({ profile, tableName: 'payments', recordId: row.id, reason });
    if (error) { alert(error.message); return; }
    alert(requiresApproval ? 'Delete request submitted for approval.' : 'Record deleted.');
    load();
  }

  async function handleClearEstate() {
    if (rows.length === 0) { alert('There are no payment records to clear for this estate.'); return; }
    const ok = confirm(`This will remove all ${rows.length} payment record(s) for ${estate?.name}. You would need to re-import to get them back. Continue?`);
    if (!ok) return;
    const typed = prompt('Type DELETE to confirm clearing all payment records for this estate.');
    if (typed !== 'DELETE') { alert('Cancelled.'); return; }
    const { error } = await supabase.from('payments').update({ is_deleted: true }).eq('estate_id', estateId).eq('is_deleted', false);
    if (error) { alert(error.message); return; }
    alert('All payment records for this estate have been cleared. You can now re-import a clean file.');
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <Link to="/payments" className="muted">&larr; All Estates</Link>
          <h2>Payments — {estate?.name || '…'}</h2>
        </div>
        <div className="flex wrap">
          <button className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button className="btn btn-outline" onClick={() => setShowImport(true)}>Bulk Import from Excel</button>
          {isAdmin && <button className="btn btn-danger" onClick={handleClearEstate}>Clear All Records for This Estate</button>}
          <button className="btn btn-primary" onClick={openNew}>+ New Payment</button>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="stat-card"><div className="value">{summary.total}</div><div className="label">Entries Shown</div></div>
        <div className="stat-card blue"><div className="value">₦{(summary.byType.property || 0).toLocaleString()}</div><div className="label">Property Payments</div></div>
        <div className="stat-card gold"><div className="value">₦{(summary.byType.infrastructure || 0).toLocaleString()}</div><div className="label">Infrastructure Payments</div></div>
        <div className="stat-card grey"><div className="value">₦{(summary.byType.legal_tdp || 0).toLocaleString()}</div><div className="label">Legal / TDP Payments</div></div>
      </div>
      <p className="muted">Total of all payment types shown: <b>₦{summary.totalAmount.toLocaleString()}</b></p>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 200 }}>
            <label>Filter by Payment Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All Types</option>
              {PAYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or reference…" />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>S/N</th><th>Subscriber Name</th><th>Property Type</th><th>Payment Type</th>
                <th>Amount</th><th>Date Paid</th><th>Reference</th>
                <CustomFieldHeaders fields={customFields} />
                <th>Remarks</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.localSerial}</td>
                  <td><Link to={`/subscriber/${estateId}/${encodeURIComponent(r.subscriber_name)}`}>{r.subscriber_name}</Link></td>
                  <td>{r.property_type}</td>
                  <td>{PAYMENT_TYPES.find((t) => t.value === r.payment_type)?.label || r.payment_type}</td>
                  <td className="right">{Number(r.amount || 0).toLocaleString()}</td>
                  <td>{r.date_paid}</td>
                  <td>{r.payment_reference}</td>
                  <CustomFieldCells fields={customFields} values={r.custom_data} />
                  <td>{r.remarks}</td>
                  <td>
                    <div className="flex wrap">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={9 + customFields.length} className="empty-state">No payment records found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {!isSupervisorPlus && <p className="muted" style={{ marginTop: 8 }}>Edits/deletes require supervisor or admin approval.</p>}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRow ? 'Edit Payment Record' : `New Payment — ${estate?.name || ''}`}</h3>
            <form onSubmit={handleSave}>
              <div className="grid cols-2">
                <div className="field" style={{ gridColumn: 'span 2' }}><label>Subscriber Name</label><input value={form.subscriber_name} onChange={(e) => setForm({ ...form, subscriber_name: e.target.value })} required /></div>
                <div className="field"><label>Property Type</label><input value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })} placeholder="e.g. 3BR, 4BR Fully" /></div>
                <div className="field">
                  <label>Payment Type</label>
                  <select value={form.payment_type} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
                    {PAYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="field"><label>Amount (₦)</label><input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
                <div className="field"><label>Date Paid (optional)</label><input type="date" value={form.date_paid} onChange={(e) => setForm({ ...form, date_paid: e.target.value })} /></div>
                <div className="field" style={{ gridColumn: 'span 2' }}><label>Reference / Teller No</label><input value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} /></div>
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

      {showColumns && <ManageColumnsModal tableName="payments" onClose={() => setShowColumns(false)} onChanged={load} />}
      {showImport && (
        <BulkImportModal
          title={`Bulk Import Payments — ${estate?.name || ''}`}
          tableName="payments"
          fieldDefs={PAYMENT_FIELD_DEFS}
          presetEstateId={estateId}
          profile={profile}
          onClose={() => setShowImport(false)}
          onImported={load}
          transformRecord={(r) => ({
            ...r,
            // Always force a valid payment_type. Summary Excel files never have this column,
            // so missing/blank must become 'property' (not 'other').
            payment_type: normalizePaymentType(r.payment_type),
          })}
        />
      )}
    </div>
  );
}

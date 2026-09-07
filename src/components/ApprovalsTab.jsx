import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { submitOrApplyUpdate, submitOrApplyDelete } from '../lib/recordActions';
import { fetchCustomFields } from '../lib/customFields';
import ManageColumnsModal from './ManageColumnsModal';
import { CustomFieldInputs, CustomFieldHeaders, CustomFieldCells } from './CustomFieldWidgets';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const BLANK = {
  title: '', purpose: '', category: '', estate_id: '', application_by: '', paid_to: '',
  amount_applied: '', amount_approved: '', date_of_approval: '', comments: '', remarks: '',
};

export default function ApprovalsTab() {
  const { profile, isSupervisorPlus } = useAuth();
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');
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
    setCustomFields(await fetchCustomFields('approvals_expenditures'));
    const { data } = await supabase
      .from('approvals_expenditures')
      .select('*, estates(name)')
      .eq('is_deleted', false)
      .order('serial_no', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))], [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter && r.category !== categoryFilter) return false;
      if (estateFilter && r.estate_id !== estateFilter) return false;
      const hay = `${r.title} ${r.purpose} ${r.paid_to} ${r.application_by}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
  }, [rows, categoryFilter, estateFilter, search]);

  const totals = useMemo(() => {
    const applied = filtered.reduce((s, r) => s + Number(r.amount_applied || 0), 0);
    const approved = filtered.reduce((s, r) => s + Number(r.amount_approved || 0), 0);
    const byCategory = {};
    filtered.forEach((r) => {
      const cat = r.category || 'Uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + Number(r.amount_approved || 0);
    });
    return { applied, approved, byCategory };
  }, [filtered]);

  const chartData = Object.entries(totals.byCategory).map(([name, value]) => ({ name, value }));

  function openNew() { setEditingRow(null); setForm(BLANK); setCustomData({}); setError(''); setShowModal(true); }
  function openEdit(row) {
    setEditingRow(row);
    setForm({
      title: row.title || '', purpose: row.purpose || '', category: row.category || '', estate_id: row.estate_id || '',
      application_by: row.application_by || '',
      paid_to: row.paid_to || '', amount_applied: row.amount_applied ?? '', amount_approved: row.amount_approved ?? '',
      date_of_approval: row.date_of_approval || '', comments: row.comments || '', remarks: row.remarks || '',
    });
    setCustomData(row.custom_data || {});
    setError(''); setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    const payload = {
      ...form,
      estate_id: form.estate_id || null,
      amount_applied: Number(form.amount_applied) || 0,
      amount_approved: Number(form.amount_approved) || 0,
      custom_data: customData,
    };

    if (editingRow) {
      const { error, requiresApproval } = await submitOrApplyUpdate({ profile, tableName: 'approvals_expenditures', recordId: editingRow.id, changes: payload });
      setSaving(false);
      if (error) { setError(error.message); return; }
      setShowModal(false);
      alert(requiresApproval ? 'Edit submitted for approval.' : 'Updated.');
      load();
      return;
    }
    const { error } = await supabase.from('approvals_expenditures').insert({ ...payload, created_by: profile.id });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setShowModal(false);
    load();
  }

  async function handleDelete(row) {
    const reason = prompt('Reason for deleting this record (required):');
    if (!reason) return;
    const { error, requiresApproval } = await submitOrApplyDelete({ profile, tableName: 'approvals_expenditures', recordId: row.id, reason });
    if (error) { alert(error.message); return; }
    alert(requiresApproval ? 'Delete request submitted for approval.' : 'Deleted.');
    load();
  }

  return (
    <div>
      <div className="page-title">
        <h2>Approvals / Expenditure</h2>
        <div className="flex">
          <button className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button className="btn btn-primary" onClick={openNew}>+ New Entry</button>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat-card"><div className="value">{filtered.length}</div><div className="label">Total Entries</div></div>
        <div className="stat-card blue"><div className="value">₦{totals.applied.toLocaleString()}</div><div className="label">Total Applied For</div></div>
        <div className="stat-card gold"><div className="value">₦{totals.approved.toLocaleString()}</div><div className="label">Total Approved</div></div>
      </div>

      {chartData.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Approved Amount by Category</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip formatter={(v) => `₦${Number(v).toLocaleString()}`} />
              <Bar dataKey="value" fill="#c9a24b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 200 }}>
            <label>Filter by Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 200 }}>
            <label>Filter by Estate</label>
            <select value={estateFilter} onChange={(e) => setEstateFilter(e.target.value)}>
              <option value="">All Estates</option>
              {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, purpose, paid to..." />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>S/N</th><th>Title</th><th>Category</th><th>Estate</th><th>Purpose</th><th>Applied By</th><th>Paid To</th>
                <th>Applied (₦)</th><th>Approved (₦)</th><th>Date</th>
                <CustomFieldHeaders fields={customFields} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.serial_no}</td><td>{r.title}</td><td>{r.category}</td><td>{r.estates?.name || '—'}</td><td>{r.purpose}</td>
                  <td>{r.application_by}</td><td>{r.paid_to}</td>
                  <td className="right">{Number(r.amount_applied || 0).toLocaleString()}</td>
                  <td className="right">{Number(r.amount_approved || 0).toLocaleString()}</td>
                  <td>{r.date_of_approval}</td>
                  <CustomFieldCells fields={customFields} values={r.custom_data} />
                  <td>
                    <div className="flex">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={11 + customFields.length} className="empty-state">No entries found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {!isSupervisorPlus && <p className="muted" style={{ marginTop: 8 }}>Edits/deletes require supervisor or admin approval.</p>}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRow ? 'Edit Entry' : 'New Approval / Expenditure Entry'}</h3>
            <form onSubmit={handleSave}>
              <div className="grid cols-2">
                <div className="field"><label>Title</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
                <div className="field"><label>Category (for grouping/totals)</label><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Construction, Logistics" /></div>
                <div className="field"><label>Estate (optional)</label>
                  <select value={form.estate_id} onChange={(e) => setForm({ ...form, estate_id: e.target.value })}>
                    <option value="">— Not estate-specific —</option>
                    {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div className="field"><label>Purpose</label><input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
                <div className="field"><label>Application Made By</label><input value={form.application_by} onChange={(e) => setForm({ ...form, application_by: e.target.value })} /></div>
                <div className="field"><label>Paid To</label><input value={form.paid_to} onChange={(e) => setForm({ ...form, paid_to: e.target.value })} /></div>
                <div className="field"><label>Amount Applied For (₦)</label><input type="number" step="0.01" value={form.amount_applied} onChange={(e) => setForm({ ...form, amount_applied: e.target.value })} /></div>
                <div className="field"><label>Amount Approved (₦)</label><input type="number" step="0.01" value={form.amount_approved} onChange={(e) => setForm({ ...form, amount_approved: e.target.value })} /></div>
                <div className="field"><label>Date of Approval</label><input type="date" value={form.date_of_approval} onChange={(e) => setForm({ ...form, date_of_approval: e.target.value })} /></div>
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

      {showColumns && <ManageColumnsModal tableName="approvals_expenditures" onClose={() => setShowColumns(false)} onChanged={load} />}
    </div>
  );
}

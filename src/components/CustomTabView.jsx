import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { submitOrApplyUpdate, submitOrApplyDelete } from '../lib/recordActions';
import { fetchCustomFields } from '../lib/customFields';
import ManageColumnsModal from './ManageColumnsModal';
import { CustomFieldInputs, CustomFieldHeaders, CustomFieldCells } from './CustomFieldWidgets';

export default function CustomTabView() {
  const { tabKey } = useParams();
  const { profile, isAdmin, isSupervisorPlus } = useAuth();
  const [tab, setTab] = useState(null);
  const [fields, setFields] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [data, setData] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, [tabKey]);

  async function load() {
    setLoading(true);
    const { data: tabRow } = await supabase.from('custom_tabs').select('*').eq('tab_key', tabKey).eq('is_deleted', false).single();
    setTab(tabRow || null);
    if (tabRow) {
      setFields(await fetchCustomFields(`tab:${tabKey}`));
      const { data: recs } = await supabase
        .from('custom_tab_records')
        .select('*')
        .eq('tab_id', tabRow.id)
        .eq('is_deleted', false)
        .order('serial_no', { ascending: false });
      setRows(recs || []);
    }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => JSON.stringify(r.data || {}).toLowerCase().includes(q));
  }, [rows, search]);

  function openNew() { setEditingRow(null); setData({}); setError(''); setShowModal(true); }
  function openEdit(row) { setEditingRow(row); setData(row.data || {}); setError(''); setShowModal(true); }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    if (editingRow) {
      const { error, requiresApproval } = await submitOrApplyUpdate({
        profile, tableName: 'custom_tab_records', recordId: editingRow.id, changes: { data },
      });
      setSaving(false);
      if (error) { setError(error.message); return; }
      setShowModal(false);
      alert(requiresApproval ? 'Edit submitted for approval.' : 'Updated.');
      load();
      return;
    }
    const { error } = await supabase.from('custom_tab_records').insert({ tab_id: tab.id, data, created_by: profile.id });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setShowModal(false);
    load();
  }

  async function handleDelete(row) {
    const reason = prompt('Reason for deleting this record (required):');
    if (!reason) return;
    const { error, requiresApproval } = await submitOrApplyDelete({ profile, tableName: 'custom_tab_records', recordId: row.id, reason });
    if (error) { alert(error.message); return; }
    alert(requiresApproval ? 'Delete request submitted for approval.' : 'Deleted.');
    load();
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (!tab) return <div className="empty-state">This tab no longer exists.</div>;

  return (
    <div>
      <div className="page-title">
        <h2>{tab.label}</h2>
        <div className="flex">
          <button className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button className="btn btn-primary" onClick={openNew}>+ New Entry</button>
        </div>
      </div>
      {tab.description && <p className="muted">{tab.description}</p>}

      <div className="card">
        <label>Search</label>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all fields…" />
      </div>

      <div className="table-wrap">
        {fields.length === 0 ? (
          <div className="empty-state">
            No columns defined yet for this tab. Click "Manage Columns" to add fields (e.g. Name, Date, Notes) before entering records.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>S/N</th>
                <CustomFieldHeaders fields={fields} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.serial_no}</td>
                  <CustomFieldCells fields={fields} values={r.data} />
                  <td>
                    <div className="flex">
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={fields.length + 2} className="empty-state">No records yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {!isSupervisorPlus && <p className="muted" style={{ marginTop: 8 }}>Edits/deletes require supervisor or admin approval.</p>}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRow ? 'Edit Entry' : `New ${tab.label} Entry`}</h3>
            <form onSubmit={handleSave}>
              {fields.length === 0 ? (
                <p className="muted">Add columns first via "Manage Columns".</p>
              ) : (
                <CustomFieldInputs fields={fields} values={data} onChange={setData} />
              )}
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving || fields.length === 0}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showColumns && (
        <ManageColumnsModal tableName={`tab:${tab.tab_key}`} onClose={() => setShowColumns(false)} onChanged={load} />
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import ManageColumnsModal from './ManageColumnsModal';

function slugify(label) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export default function CustomTabsAdmin({ onTabsChanged }) {
  const { profile, isAdmin } = useAuth();
  const [tabs, setTabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [columnsForTab, setColumnsForTab] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('custom_tabs').select('*').eq('is_deleted', false).order('created_at');
    setTabs(data || []);
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!label.trim()) { setError('Tab name is required.'); return; }
    const tab_key = slugify(label);
    if (!tab_key) { setError('Please use a name with letters or numbers.'); return; }
    setSaving(true);
    const { error } = await supabase.from('custom_tabs').insert({ tab_key, label: label.trim(), description, created_by: profile.id });
    setSaving(false);
    if (error) { setError(error.code === '23505' ? 'A tab with a similar name already exists.' : error.message); return; }
    setLabel(''); setDescription(''); setShowModal(false);
    await load();
    onTabsChanged?.();
  }

  async function handleDelete(tab) {
    if (!confirm(`Remove the "${tab.label}" tab? Its records will be hidden but not permanently deleted.`)) return;
    await supabase.from('custom_tabs').update({ is_deleted: true }).eq('id', tab.id);
    await load();
    onTabsChanged?.();
  }

  return (
    <div>
      <div className="page-title">
        <h2>Custom Tabs</h2>
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Tab</button>}
      </div>
      <p className="muted">
        Create new sections for the sidebar for record types that aren't covered yet (e.g. "Complaints", "Site Visits"). Each new tab gets its own register — add columns to it with "Manage Columns" once created.
      </p>

      {loading ? <p className="muted">Loading…</p> : tabs.length === 0 ? (
        <div className="empty-state">No custom tabs yet.</div>
      ) : (
        <div className="grid cols-3">
          {tabs.map((t) => (
            <div className="card" key={t.id}>
              <h3>{t.label}</h3>
              <p className="muted">{t.description || 'No description.'}</p>
              <div className="flex wrap">
                <button className="btn btn-outline btn-sm" onClick={() => setColumnsForTab(t)}>Manage Columns</button>
                {isAdmin && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t)}>Remove Tab</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Tab</h3>
            <form onSubmit={handleCreate}>
              <div className="field"><label>Tab Name</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Site Visits" required /></div>
              <div className="field"><label>Description (optional)</label><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create Tab'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {columnsForTab && (
        <ManageColumnsModal tableName={`tab:${columnsForTab.tab_key}`} onClose={() => setColumnsForTab(null)} />
      )}
    </div>
  );
}

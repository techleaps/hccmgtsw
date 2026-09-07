import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { Link } from 'react-router-dom';

export default function EstatesTab() {
  const { profile, isAdmin } = useAuth();
  const [estates, setEstates] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'site_and_services', description: '', propertyTypes: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(data || []);
    if (data?.length) {
      const { data: subs } = await supabase.from('subscribers').select('estate_id, offer_made, allocation_made').eq('is_deleted', false);
      const c = {};
      (subs || []).forEach((s) => {
        c[s.estate_id] = c[s.estate_id] || { PO: 0, FA: 0 };
        if (s.offer_made) c[s.estate_id].PO += 1;
        if (s.allocation_made) c[s.estate_id].FA += 1;
      });
      setCounts(c);
    }
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) {
      setError('Estate name is required.');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('estates')
      .insert({ name: form.name.trim(), category: form.category, description: form.description, created_by: profile.id })
      .select()
      .single();

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }

    const types = form.propertyTypes.split(',').map((t) => t.trim()).filter(Boolean);
    if (types.length) {
      await supabase.from('estate_property_types').insert(types.map((property_type) => ({ estate_id: data.id, property_type })));
    }

    setSaving(false);
    setShowModal(false);
    setForm({ name: '', category: 'site_and_services', description: '', propertyTypes: '' });
    load();
  }

  return (
    <div>
      <div className="page-title">
        <h2>Estates</h2>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            + New Estate
          </button>
        )}
      </div>

      {loading ? (
        <p className="muted">Loading estates…</p>
      ) : estates.length === 0 ? (
        <div className="empty-state">No estates yet. {isAdmin ? 'Click "New Estate" to add one.' : ''}</div>
      ) : (
        <div className="grid cols-3">
          {estates.map((e) => (
            <Link to={`/estates/${e.id}`} key={e.id} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
              <h3>{e.name}</h3>
              <p className="muted" style={{ textTransform: 'capitalize' }}>{e.category.replace(/_/g, ' ')}</p>
              <div className="flex" style={{ marginTop: 8 }}>
                <span className="tag PO">PO: {counts[e.id]?.PO || 0}</span>
                <span className="tag FA">FA: {counts[e.id]?.FA || 0}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Estate</h3>
            <form onSubmit={handleCreate}>
              <div className="field">
                <label>Estate Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="site_and_services">Site &amp; Services (land + infrastructure)</option>
                  <option value="carcass_level">Delivered at Carcass Level</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="field">
                <label>Property Types Available (comma separated — e.g. 3br, 4br, 500sqm, 1 hectare)</label>
                <input
                  value={form.propertyTypes}
                  onChange={(e) => setForm({ ...form, propertyTypes: e.target.value })}
                  placeholder="3br, 4br, 500sqm"
                />
                <p className="muted">These will appear as dropdown options when recording allocations for this estate.</p>
              </div>
              <div className="field">
                <label>Description (optional)</label>
                <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create Estate'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

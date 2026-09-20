import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { blankToNull } from '../lib/sanitize';

const BLANK = {
  contractor_name: '', phone_number: '', address: '', description: '',
  contract_amount: '', amount_given: '', award_date: '', house_numbers: '',
  property_type: '', status: 'active', remarks: '', estate_id: '',
};

const STATUS_OPTS = ['active', 'completed', 'terminated'];

export default function ContractAwardsTab() {
  const { profile, isSupervisorPlus } = useAuth();
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [estateFilter, setEstateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [eRes, rRes] = await Promise.all([
      supabase.from('estates').select('*').eq('is_deleted', false).order('name'),
      supabase.from('contract_awards').select('*, estates(name)').eq('is_deleted', false).order('award_date', { ascending: false }),
    ]);
    setEstates(eRes.data || []);
    setRows(rRes.data || []);
    setLoading(false);
  }

  const filtered = useMemo(() => rows.filter((r) => {
    if (estateFilter && r.estate_id !== estateFilter) return false;
    const hay = `${r.contractor_name} ${r.phone_number || ''} ${r.house_numbers || ''} ${r.description || ''}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  }), [rows, estateFilter, search]);

  const totals = useMemo(() => ({
    count: filtered.length,
    contract: filtered.reduce((s, r) => s + Number(r.contract_amount || 0), 0),
    given: filtered.reduce((s, r) => s + Number(r.amount_given || 0), 0),
  }), [filtered]);

  function openNew() {
    setEditing(null);
    setForm({ ...BLANK, estate_id: estateFilter || '' });
    setError('');
    setShowModal(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({
      contractor_name: row.contractor_name || '',
      phone_number: row.phone_number || '',
      address: row.address || '',
      description: row.description || '',
      contract_amount: row.contract_amount ?? '',
      amount_given: row.amount_given ?? '',
      award_date: row.award_date || '',
      house_numbers: row.house_numbers || '',
      property_type: row.property_type || '',
      status: row.status || 'active',
      remarks: row.remarks || '',
      estate_id: row.estate_id || '',
    });
    setError('');
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!form.contractor_name.trim()) { setError('Contractor name is required.'); return; }
    setSaving(true);
    const payload = blankToNull({
      ...form,
      contract_amount: Number(form.contract_amount) || 0,
      amount_given: Number(form.amount_given) || 0,
      estate_id: form.estate_id || null,
    }, ['award_date']);

    if (editing) {
      const { error } = await supabase.from('contract_awards').update(payload).eq('id', editing.id);
      setSaving(false);
      if (error) { setError(error.message); return; }
    } else {
      const { error } = await supabase.from('contract_awards').insert({ ...payload, created_by: profile.id });
      setSaving(false);
      if (error) { setError(error.message); return; }
    }
    setShowModal(false);
    load();
  }

  async function handleDelete(row) {
    if (!confirm(`Soft-delete award for ${row.contractor_name}?`)) return;
    await supabase.from('contract_awards').update({ is_deleted: true }).eq('id', row.id);
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Award of Contract</h2>
          <p className="muted" style={{ margin: 0 }}>Contractors awarded work (build, infrastructure, etc.)</p>
        </div>
        <div className="flex">
          <Link className="btn btn-outline" to="/construction">Construction Units</Link>
          <button className="btn btn-primary" onClick={openNew}>+ New Award</button>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat-card"><div className="value">{totals.count}</div><div className="label">Awards Shown</div></div>
        <div className="stat-card gold"><div className="value">₦{totals.contract.toLocaleString()}</div><div className="label">Total Contract Amount</div></div>
        <div className="stat-card blue"><div className="value">₦{totals.given.toLocaleString()}</div><div className="label">Total Amount Given</div></div>
      </div>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 180 }}>
            <label>Estate</label>
            <select value={estateFilter} onChange={(e) => setEstateFilter(e.target.value)}>
              <option value="">All Estates</option>
              {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Contractor, phone, house nos…" />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>#</th><th>Contractor</th><th>Phone</th><th>Estate</th><th>House No(s)</th>
                <th className="right">Contract ₦</th><th className="right">Given ₦</th>
                <th>Date</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td><b>{r.contractor_name}</b><div className="muted" style={{ fontSize: 12 }}>{r.description}</div></td>
                  <td>{r.phone_number || '—'}</td>
                  <td>{r.estates?.name || '—'}</td>
                  <td>{r.house_numbers || '—'}</td>
                  <td className="right">{Number(r.contract_amount || 0).toLocaleString()}</td>
                  <td className="right">{Number(r.amount_given || 0).toLocaleString()}</td>
                  <td>{r.award_date || '—'}</td>
                  <td><span className="tag">{r.status || 'active'}</span></td>
                  <td>
                    <div className="flex">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      {isSupervisorPlus && (
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="empty-state">No contract awards yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? 'Edit Award' : 'New Award of Contract'}</h3>
            <form onSubmit={handleSave}>
              <div className="field"><label>Contractor Name *</label>
                <input value={form.contractor_name} onChange={(e) => setForm({ ...form, contractor_name: e.target.value })} required />
              </div>
              <div className="grid cols-2">
                <div className="field"><label>Phone</label>
                  <input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
                </div>
                <div className="field"><label>Estate</label>
                  <select value={form.estate_id} onChange={(e) => setForm({ ...form, estate_id: e.target.value })}>
                    <option value="">—</option>
                    {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>Address</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="field"><label>Description of work</label>
                <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid cols-2">
                <div className="field"><label>Contract amount (₦)</label>
                  <input type="number" step="0.01" value={form.contract_amount} onChange={(e) => setForm({ ...form, contract_amount: e.target.value })} />
                </div>
                <div className="field"><label>Amount given so far (₦)</label>
                  <input type="number" step="0.01" value={form.amount_given} onChange={(e) => setForm({ ...form, amount_given: e.target.value })} />
                </div>
              </div>
              <div className="grid cols-2">
                <div className="field"><label>Award date</label>
                  <input type="date" value={form.award_date} onChange={(e) => setForm({ ...form, award_date: e.target.value })} />
                </div>
                <div className="field"><label>Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>House number(s)</label>
                <input value={form.house_numbers} onChange={(e) => setForm({ ...form, house_numbers: e.target.value })} placeholder="e.g. A1, A2, A15-A20" />
              </div>
              <div className="field"><label>Property type</label>
                <input value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })} placeholder="4BR Fully, 3BR…" />
              </div>
              <div className="field"><label>Remarks</label>
                <textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';

export default function EstateDetail() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const [estate, setEstate] = useState(null);
  const [types, setTypes] = useState([]);
  const [subscribers, setSubscribers] = useState([]);
  const [newType, setNewType] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const [estateRes, typesRes, allocRes] = await Promise.all([
      supabase.from('estates').select('*').eq('id', id).single(),
      supabase.from('estate_property_types').select('*').eq('estate_id', id).order('property_type'),
      supabase.from('subscribers').select('*').eq('estate_id', id).eq('is_deleted', false).order('serial_no'),
    ]);
    setEstate(estateRes.data);
    setTypes(typesRes.data || []);
    setSubscribers(allocRes.data || []);
    setLoading(false);
  }

  async function addType(e) {
    e.preventDefault();
    if (!newType.trim()) return;
    await supabase.from('estate_property_types').insert({ estate_id: id, property_type: newType.trim() });
    setNewType('');
    load();
  }

  async function removeType(typeId) {
    if (!confirm('Remove this property type option?')) return;
    await supabase.from('estate_property_types').delete().eq('id', typeId);
    load();
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (!estate) return <div className="empty-state">Estate not found.</div>;

  const poCount = subscribers.filter((s) => s.offer_made).length;
  const faCount = subscribers.filter((s) => s.allocation_made).length;

  return (
    <div>
      <div className="page-title">
        <div>
          <Link to="/estates" className="muted">&larr; Back to Estates</Link>
          <h2>{estate.name}</h2>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat-card blue"><div className="value">{poCount}</div><div className="label">Provisional Offers</div></div>
        <div className="stat-card gold"><div className="value">{faCount}</div><div className="label">Final Allocations</div></div>
        <div className="stat-card grey"><div className="value">{subscribers.length}</div><div className="label">Total Subscribers</div></div>
      </div>

      <div className="card">
        <h3>Property Types (used as dropdown when recording allocations here)</h3>
        <div className="flex wrap">
          {types.map((t) => (
            <span key={t.id} className="tag PO" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {t.property_type}
              {isAdmin && (
                <span style={{ cursor: 'pointer', fontWeight: 900 }} onClick={() => removeType(t.id)}>×</span>
              )}
            </span>
          ))}
          {types.length === 0 && <span className="muted">No property types defined yet.</span>}
        </div>
        {isAdmin && (
          <form onSubmit={addType} className="flex" style={{ marginTop: 12, maxWidth: 400 }}>
            <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="e.g. 3br, 500sqm" />
            <button className="btn btn-primary btn-sm">Add</button>
          </form>
        )}
      </div>

      <div className="card">
        <h3>Records in this Estate</h3>
        <div className="flex wrap" style={{ marginBottom: 12 }}>
          <Link className="btn btn-outline btn-sm" to="/subscribers">Manage Subscriber Records</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>S/N</th><th>Subscriber</th><th>PON</th><th>Offer</th><th>Allocation No</th><th>Allocated</th>
                <th>Property Type</th><th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map((s) => (
                <tr key={s.id}>
                  <td>{s.serial_no}</td>
                  <td>{s.subscriber_name}</td>
                  <td>{s.pon}</td>
                  <td>{s.offer_made ? '✓' : ''}</td>
                  <td>{s.allocation_no}</td>
                  <td>{s.allocation_made ? '✓' : ''}</td>
                  <td>{s.property_type}</td>
                  <td>{s.phone_number}</td>
                </tr>
              ))}
              {subscribers.length === 0 && (
                <tr><td colSpan={8} className="empty-state">No subscriber records yet for this estate.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

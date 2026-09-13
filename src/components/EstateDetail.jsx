import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';

export default function EstateDetail() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const [estate, setEstate] = useState(null);
  const [types, setTypes] = useState([]);
  const [offers, setOffers] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [newType, setNewType] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const [estateRes, typesRes, offersRes, allocRes] = await Promise.all([
      supabase.from('estates').select('*').eq('id', id).single(),
      supabase.from('estate_property_types').select('*').eq('estate_id', id).order('property_type'),
      supabase.from('offers').select('*').eq('estate_id', id).eq('is_deleted', false).order('serial_no'),
      supabase.from('allocation_records').select('*').eq('estate_id', id).eq('is_deleted', false).order('serial_no'),
    ]);
    setEstate(estateRes.data);
    setTypes(typesRes.data || []);
    setOffers(offersRes.data || []);
    setAllocations(allocRes.data || []);
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

  return (
    <div>
      <div className="page-title">
        <div>
          <Link to="/estates" className="muted">&larr; Back to Estates</Link>
          <h2>{estate.name}</h2>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat-card blue"><div className="value">{offers.length}</div><div className="label">Offers</div></div>
        <div className="stat-card gold"><div className="value">{allocations.length}</div><div className="label">Allocations</div></div>
        <div className="stat-card grey"><div className="value">{offers.length + allocations.length}</div><div className="label">Total Records</div></div>
      </div>

      <div className="card">
        <h3>Property Types (used as dropdown when recording offers/allocations here)</h3>
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
        <h3>Offers in this Estate</h3>
        <div className="flex wrap" style={{ marginBottom: 12 }}>
          <Link className="btn btn-outline btn-sm" to="/offers">Manage Offers</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>S/N</th><th>Subscriber</th><th>Form No</th><th>Printed</th><th>Collected</th><th>Property Type</th><th>Phone</th></tr>
            </thead>
            <tbody>
              {offers.map((s) => (
                <tr key={s.id}>
                  <td>{s.serial_no}</td><td>{s.subscriber_name}</td><td>{s.form_no}</td>
                  <td>{s.offer_printed ? '✓' : ''}</td><td>{s.offer_collected ? '✓' : ''}</td>
                  <td>{s.property_type}</td><td>{s.phone_number}</td>
                </tr>
              ))}
              {offers.length === 0 && <tr><td colSpan={7} className="empty-state">No offer records yet for this estate.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Allocations in this Estate</h3>
        <div className="flex wrap" style={{ marginBottom: 12 }}>
          <Link className="btn btn-outline btn-sm" to="/allocations">Manage Allocations</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>S/N</th><th>House No</th><th>Subscriber</th><th>Signed</th><th>Collected</th><th>Property Type</th></tr>
            </thead>
            <tbody>
              {allocations.map((s) => (
                <tr key={s.id}>
                  <td>{s.serial_no}</td><td>{s.house_no}</td><td>{s.subscriber_name}</td>
                  <td>{s.signed ? '✓' : ''}</td><td>{s.collected ? '✓' : ''}</td><td>{s.property_type}</td>
                </tr>
              ))}
              {allocations.length === 0 && <tr><td colSpan={6} className="empty-state">No allocation records yet for this estate.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

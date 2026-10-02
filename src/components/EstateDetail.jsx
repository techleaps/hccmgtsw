import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';

const BLANK_TYPE_FORM = { property_type: '', expected_property_cost: '', expected_infrastructure_fee: '', expected_legal_tdp_fee: '' };

export default function EstateDetail() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const [estate, setEstate] = useState(null);
  const [types, setTypes] = useState([]);
  const [offers, setOffers] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [newType, setNewType] = useState(BLANK_TYPE_FORM);
  const [editingType, setEditingType] = useState(null);
  const [editingEstate, setEditingEstate] = useState(false);
  const [estateForm, setEstateForm] = useState({ name: '', category: '', description: '' });
  const [estateSaving, setEstateSaving] = useState(false);
  const [editForm, setEditForm] = useState(BLANK_TYPE_FORM);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const [estateRes, typesRes, offersRes, allocRes, paymentsRes] = await Promise.all([
      supabase.from('estates').select('*').eq('id', id).single(),
      supabase.from('estate_property_types').select('*').eq('estate_id', id).order('property_type'),
      supabase.from('offers').select('*').eq('estate_id', id).eq('is_deleted', false).order('serial_no'),
      supabase.from('allocation_records').select('*').eq('estate_id', id).eq('is_deleted', false).order('serial_no'),
      supabase.from('payments').select('id, amount').eq('estate_id', id).eq('is_deleted', false),
    ]);
    setEstate(estateRes.data);
    setTypes(typesRes.data || []);
    setOffers(offersRes.data || []);
    setAllocations(allocRes.data || []);
    setPayments(paymentsRes.data || []);
    setLoading(false);
  }

  async function addType(e) {
    e.preventDefault();
    if (!newType.property_type.trim()) return;
    await supabase.from('estate_property_types').insert({
      estate_id: id,
      property_type: newType.property_type.trim(),
      expected_property_cost: newType.expected_property_cost === '' ? null : Number(newType.expected_property_cost),
      expected_infrastructure_fee: newType.expected_infrastructure_fee === '' ? null : Number(newType.expected_infrastructure_fee),
      expected_legal_tdp_fee: newType.expected_legal_tdp_fee === '' ? null : Number(newType.expected_legal_tdp_fee),
    });
    setNewType(BLANK_TYPE_FORM);
    load();
  }

  function openEditType(t) {
    setEditingType(t.id);
    setEditForm({
      property_type: t.property_type,
      expected_property_cost: t.expected_property_cost ?? '',
      expected_infrastructure_fee: t.expected_infrastructure_fee ?? '',
      expected_legal_tdp_fee: t.expected_legal_tdp_fee ?? '',
    });
  }

  async function saveEditType(typeId) {
    await supabase.from('estate_property_types').update({
      property_type: editForm.property_type.trim(),
      expected_property_cost: editForm.expected_property_cost === '' ? null : Number(editForm.expected_property_cost),
      expected_infrastructure_fee: editForm.expected_infrastructure_fee === '' ? null : Number(editForm.expected_infrastructure_fee),
      expected_legal_tdp_fee: editForm.expected_legal_tdp_fee === '' ? null : Number(editForm.expected_legal_tdp_fee),
    }).eq('id', typeId);
    setEditingType(null);
    load();
  }

  async function removeType(typeId) {
    if (!confirm('Remove this property type option? Existing records keep their property type text either way.')) return;
    await supabase.from('estate_property_types').delete().eq('id', typeId);
    load();
  }

  function openEditEstate() {
    setEstateForm({
      name: estate?.name || '',
      category: estate?.category || 'site_and_services',
      description: estate?.description || '',
    });
    setEditingEstate(true);
  }

  async function saveEstate(e) {
    e.preventDefault();
    if (!estateForm.name.trim()) { alert('Estate name is required.'); return; }
    setEstateSaving(true);
    const { error } = await supabase.from('estates').update({
      name: estateForm.name.trim(),
      category: estateForm.category,
      description: estateForm.description || null,
    }).eq('id', id);
    setEstateSaving(false);
    if (error) { alert(error.message); return; }
    setEditingEstate(false);
    load();
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (!estate) return <div className="empty-state">Estate not found.</div>;

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <div>
      <div className="page-title">
        <div>
          <Link to="/estates" className="muted">&larr; Back to Estates</Link>
          <h2>{estate.name}</h2>
        </div>
        {isAdmin && (
          <button type="button" className="btn btn-outline" onClick={openEditEstate}>Edit Estate Name</button>
        )}
      </div>

      {editingEstate && (
        <div className="modal-overlay" onClick={() => setEditingEstate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Estate</h3>
            <form onSubmit={saveEstate}>
              <div className="field">
                <label>Estate Name</label>
                <input value={estateForm.name} onChange={(e) => setEstateForm({ ...estateForm, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Category</label>
                <select value={estateForm.category} onChange={(e) => setEstateForm({ ...estateForm, category: e.target.value })}>
                  <option value="site_and_services">Site and Services</option>
                  <option value="carcass">Carcass</option>
                  <option value="fully_built">Fully Built</option>
                  <option value="mixed">Mixed</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="field">
                <label>Description</label>
                <textarea rows={2} value={estateForm.description} onChange={(e) => setEstateForm({ ...estateForm, description: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setEditingEstate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={estateSaving}>{estateSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid cols-4">
        <div className="stat-card blue"><div className="value">{offers.length}</div><div className="label">Offers</div></div>
        <div className="stat-card gold"><div className="value">{allocations.length}</div><div className="label">Allocations</div></div>
        <div className="stat-card grey"><div className="value">{payments.length}</div><div className="label">Payment Entries</div></div>
        <div className="stat-card"><div className="value">₦{totalPaid.toLocaleString()}</div><div className="label">Total Paid (All Fee Types)</div></div>
      </div>

      <div className="card">
        <h3>Property Types &amp; Expected Fees</h3>
        <p className="muted">
          These property types appear as a dropdown when recording offers/allocations/payments here. Setting the
          expected Property Cost, Infrastructure Fee, and Legal/TDP Fee for each type lets the Subscriber Profile
          and Analysis pages calculate accurate payment percentages — these fees vary by estate, so set them per
          estate here.
        </p>
        <p className="muted">
          <b>Price revised mid-way?</b> Add a separate row per rate, e.g. "3 Bedroom Terrace — Old Rate" and
          "3 Bedroom Terrace — New Rate", each with its own Expected Property Cost. Then record every subscriber
          under whichever one actually applies to them. That keeps someone who completed payment at the old
          price showing as fully paid, instead of being measured against the new, higher cost.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Property Type</th><th>Expected Property Cost (₦)</th><th>Expected Infrastructure Fee (₦)</th><th>Expected Legal/TDP Fee (₦)</th><th></th></tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  {editingType === t.id ? (
                    <>
                      <td><input value={editForm.property_type} onChange={(e) => setEditForm({ ...editForm, property_type: e.target.value })} /></td>
                      <td><input type="number" value={editForm.expected_property_cost} onChange={(e) => setEditForm({ ...editForm, expected_property_cost: e.target.value })} /></td>
                      <td><input type="number" value={editForm.expected_infrastructure_fee} onChange={(e) => setEditForm({ ...editForm, expected_infrastructure_fee: e.target.value })} /></td>
                      <td><input type="number" value={editForm.expected_legal_tdp_fee} onChange={(e) => setEditForm({ ...editForm, expected_legal_tdp_fee: e.target.value })} /></td>
                      <td>
                        <div className="flex">
                          <button className="btn btn-primary btn-sm" onClick={() => saveEditType(t.id)}>Save</button>
                          <button className="btn btn-outline btn-sm" onClick={() => setEditingType(null)}>Cancel</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{t.property_type}</td>
                      <td className="right">{t.expected_property_cost != null ? Number(t.expected_property_cost).toLocaleString() : <span className="muted">Not set</span>}</td>
                      <td className="right">{t.expected_infrastructure_fee != null ? Number(t.expected_infrastructure_fee).toLocaleString() : <span className="muted">Not set</span>}</td>
                      <td className="right">{t.expected_legal_tdp_fee != null ? Number(t.expected_legal_tdp_fee).toLocaleString() : <span className="muted">Not set</span>}</td>
                      <td>
                        {isAdmin && (
                          <div className="flex">
                            <button className="btn btn-outline btn-sm" onClick={() => openEditType(t)}>Edit</button>
                            <button className="btn btn-danger btn-sm" onClick={() => removeType(t.id)}>Remove</button>
                          </div>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {types.length === 0 && <tr><td colSpan={5} className="empty-state">No property types defined yet.</td></tr>}
            </tbody>
          </table>
        </div>

        {isAdmin && (
          <form onSubmit={addType} style={{ marginTop: 16 }}>
            <div className="grid cols-4">
              <div className="field"><label>New Property Type</label><input value={newType.property_type} onChange={(e) => setNewType({ ...newType, property_type: e.target.value })} placeholder="e.g. 3br, 500sqm" /></div>
              <div className="field"><label>Expected Property Cost (₦)</label><input type="number" value={newType.expected_property_cost} onChange={(e) => setNewType({ ...newType, expected_property_cost: e.target.value })} placeholder="optional" /></div>
              <div className="field"><label>Expected Infrastructure Fee (₦)</label><input type="number" value={newType.expected_infrastructure_fee} onChange={(e) => setNewType({ ...newType, expected_infrastructure_fee: e.target.value })} placeholder="optional" /></div>
              <div className="field"><label>Expected Legal/TDP Fee (₦)</label><input type="number" value={newType.expected_legal_tdp_fee} onChange={(e) => setNewType({ ...newType, expected_legal_tdp_fee: e.target.value })} placeholder="optional" /></div>
            </div>
            <button className="btn btn-primary btn-sm">Add Property Type</button>
          </form>
        )}
      </div>

      <div className="card">
        <h3>Offers in this Estate</h3>
        <div className="flex wrap" style={{ marginBottom: 12 }}>
          <Link className="btn btn-outline btn-sm" to={`/offers/${id}`}>Manage Offers</Link>
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
          <Link className="btn btn-outline btn-sm" to={`/allocations/${id}`}>Manage Allocations</Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>S/N</th><th>House No</th><th>Subscriber</th><th>Signed</th><th>Collected</th><th>Property Type</th></tr>
            </thead>
            <tbody>
              {allocations.map((s) => (
                <tr key={s.id}>
                  <td>{s.serial_no}</td><td>{s.house_no}</td><td>{s.subscriber_name || <span className="tag rejected">Vacant</span>}</td>
                  <td>{s.signed ? '✓' : ''}</td><td>{s.collected ? '✓' : ''}</td><td>{s.property_type}</td>
                </tr>
              ))}
              {allocations.length === 0 && <tr><td colSpan={6} className="empty-state">No allocation records yet for this estate.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Payments in this Estate</h3>
        <div className="flex wrap">
          <Link className="btn btn-outline btn-sm" to={`/payments/${id}`}>Manage Payments</Link>
          <Link className="btn btn-outline btn-sm" to={`/analysis/${id}`}>View Payment Analysis</Link>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function OffersEstatesTab() {
  const [estates, setEstates] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(data || []);
    const { data: offers } = await supabase.from('offers').select('estate_id, offer_collected').eq('is_deleted', false);
    const c = {};
    (offers || []).forEach((o) => {
      c[o.estate_id] = c[o.estate_id] || { total: 0, collected: 0 };
      c[o.estate_id].total += 1;
      if (o.offer_collected) c[o.estate_id].collected += 1;
    });
    setCounts(c);
    setLoading(false);
  }

  return (
    <div>
      <div className="page-title"><h2>Offers — Select an Estate</h2></div>
      <p className="muted">Click an estate to view, add, edit, or bulk-import its offer records.</p>

      {loading ? <p className="muted">Loading…</p> : (
        <div className="grid cols-3">
          {estates.map((e) => (
            <Link to={`/offers/${e.id}`} key={e.id} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <h3>{e.name}</h3>
              <p className="muted">{(e.category || '').replace(/_/g, ' ')}</p>
              <div className="flex">
                <span className="tag PO">Total: {counts[e.id]?.total || 0}</span>
                <span className="tag approved">Collected: {counts[e.id]?.collected || 0}</span>
              </div>
            </Link>
          ))}
          {estates.length === 0 && <div className="empty-state">No estates yet — create one under Estates first.</div>}
        </div>
      )}
    </div>
  );
}

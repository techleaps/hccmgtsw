import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function PaymentsEstatesTab() {
  const [estates, setEstates] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(data || []);
    const { data: payments } = await supabase.from('payments').select('estate_id, amount').eq('is_deleted', false);
    const c = {};
    (payments || []).forEach((p) => {
      c[p.estate_id] = c[p.estate_id] || { total: 0, amount: 0 };
      c[p.estate_id].total += 1;
      c[p.estate_id].amount += Number(p.amount || 0);
    });
    setCounts(c);
    setLoading(false);
  }

  return (
    <div>
      <div className="page-title"><h2>Payments — Select an Estate</h2></div>
      <p className="muted">Click an estate to view, add, edit, or bulk-import its payment records (Property, Infrastructure, Legal/TDP).</p>

      {loading ? <p className="muted">Loading…</p> : (
        <div className="grid cols-3">
          {estates.map((e) => (
            <Link to={`/payments/${e.id}`} key={e.id} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <h3>{e.name}</h3>
              <p className="muted">{(e.category || '').replace(/_/g, ' ')}</p>
              <div className="flex">
                <span className="tag PO">Entries: {counts[e.id]?.total || 0}</span>
                <span className="tag approved">₦{(counts[e.id]?.amount || 0).toLocaleString()}</span>
              </div>
            </Link>
          ))}
          {estates.length === 0 && <div className="empty-state">No estates yet — create one under Estates first.</div>}
        </div>
      )}
    </div>
  );
}

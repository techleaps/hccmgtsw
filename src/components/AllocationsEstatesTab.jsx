import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fetchAllFrom } from '../lib/fetchAll';

export default function AllocationsEstatesTab() {
  const [estates, setEstates] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(data || []);
    let allocs = [];
    try {
      allocs = await fetchAllFrom('allocation_records', (q) =>
        q.select('estate_id, collected').eq('is_deleted', false)
      );
    } catch {
      const { data: a } = await supabase.from('allocation_records').select('estate_id, collected').eq('is_deleted', false);
      allocs = a || [];
    }
    const c = {};
    (allocs || []).forEach((a) => {
      c[a.estate_id] = c[a.estate_id] || { total: 0, collected: 0 };
      c[a.estate_id].total += 1;
      if (a.collected) c[a.estate_id].collected += 1;
    });
    setCounts(c);
    setLoading(false);
  }

  return (
    <div>
      <div className="page-title"><h2>Allocations — Select an Estate</h2></div>
      <p className="muted">Click an estate to view, add, edit, or bulk-import its allocation records.</p>

      {loading ? <p className="muted">Loading…</p> : (
        <div className="grid cols-3">
          {estates.map((e) => (
            <Link to={`/allocations/${e.id}`} key={e.id} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <h3>{e.name}</h3>
              <p className="muted">{(e.category || '').replace(/_/g, ' ')}</p>
              <div className="flex">
                <span className="tag FA">Total: {counts[e.id]?.total || 0}</span>
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

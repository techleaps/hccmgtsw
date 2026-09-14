import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function AnalysisEstatesTab() {
  const [estates, setEstates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('estates').select('*').eq('is_deleted', false).order('name')
      .then(({ data }) => { setEstates(data || []); setLoading(false); });
  }, []);

  return (
    <div>
      <div className="page-title"><h2>Payment Analysis — Select an Estate</h2></div>
      <p className="muted">
        See who has paid 100% and above, 60–99%, or below 60% of the expected property cost, cross-referenced
        with whether they've been allocated yet — to help decide who to house, who to follow up with, and who
        may need a refund.
      </p>

      {loading ? <p className="muted">Loading…</p> : (
        <div className="grid cols-3">
          {estates.map((e) => (
            <Link to={`/analysis/${e.id}`} key={e.id} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <h3>{e.name}</h3>
              <p className="muted">{(e.category || '').replace(/_/g, ' ')}</p>
            </Link>
          ))}
          {estates.length === 0 && <div className="empty-state">No estates yet — create one under Estates first.</div>}
        </div>
      )}
    </div>
  );
}

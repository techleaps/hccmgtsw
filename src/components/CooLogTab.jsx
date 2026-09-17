import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function CooLogTab() {
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [estateFilter, setEstateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: estatesData } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(estatesData || []);
    const { data } = await supabase
      .from('ownership_changes')
      .select('*, offers(estate_id, estates(name)), allocation_records(estate_id, estates(name)), estates(name)')
      .order('created_at', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }

  function estateOf(r) {
    return r.estates?.name
      || r.offers?.estates?.name
      || r.allocation_records?.estates?.name
      || '—';
  }
  function estateIdOf(r) {
    return r.estate_id || r.offers?.estate_id || r.allocation_records?.estate_id || null;
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (estateFilter && estateIdOf(r) !== estateFilter) return false;
      const hay = `${r.previous_owner} ${r.new_owner}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
  }, [rows, estateFilter, search]);

  const totalFees = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.amount_paid || 0), 0),
    [filtered]
  );

  return (
    <div>
      <div className="page-title">
        <h2>Change of Ownership — History</h2>
        <div className="flex">
          <Link className="btn btn-outline" to="/offers">Offers Register</Link>
          <Link className="btn btn-primary" to="/allocations">Allocations Register</Link>
        </div>
      </div>
      <p className="muted">
        To record a new change of ownership, open the subscriber&apos;s row in the Allocations (or Offers)
        register and click <b>Record COO</b>. Capture the COO fee and optional payment evidence there.
      </p>

      <div className="grid cols-3">
        <div className="stat-card">
          <div className="value">{filtered.length}</div>
          <div className="label">Total Ownership Changes</div>
        </div>
        <div className="stat-card gold">
          <div className="value">₦{totalFees.toLocaleString()}</div>
          <div className="label">Total COO Fees Recorded</div>
        </div>
      </div>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 180 }}>
            <label>Filter by Estate</label>
            <select value={estateFilter} onChange={(e) => setEstateFilter(e.target.value)}>
              <option value="">All Estates</option>
              {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <label>Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search previous or new owner name…"
            />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Estate</th>
                <th>Previous Owner</th>
                <th>New Owner</th>
                <th>House / PON</th>
                <th className="right">COO Fee (₦)</th>
                <th>Reason</th>
                <th>Comments</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.date_changed || '—'}</td>
                  <td>{estateOf(r)}</td>
                  <td>{r.previous_owner}</td>
                  <td>
                    {estateIdOf(r) ? (
                      <Link to={`/subscriber/${estateIdOf(r)}/${encodeURIComponent(r.new_owner)}`}>
                        {r.new_owner}
                      </Link>
                    ) : r.new_owner}
                  </td>
                  <td>{r.new_pon || r.new_allocation_no || '—'}</td>
                  <td className="right">{Number(r.amount_paid || 0).toLocaleString()}</td>
                  <td>{r.reason || '—'}</td>
                  <td>{r.comments || '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No ownership changes recorded yet. Use <b>Record COO</b> on an allocation row (e.g. Kuje estate).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

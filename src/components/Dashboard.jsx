import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Link, useNavigate } from 'react-router-dom';

const COLORS = ['#1f8fd6', '#c9a24b', '#1e9e5a', '#d9483b', '#8b5cf6', '#0b2545', '#f59e0b', '#0891b2'];
const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', supervisor: 'Supervisor', user: 'User' };

export default function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [byEstate, setByEstate] = useState([]);
  const [byPropertyType, setByPropertyType] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return undefined;
    }
    const handle = setTimeout(() => runSearch(q), 300);
    return () => clearTimeout(handle);
  }, [searchQ]);

  async function runSearch(q) {
    setSearching(true);
    const pattern = `%${q}%`;
    // Search across the whole operational DB, not only allocations
    const [payRes, offerRes, allocRes, refundRes, cooPrevRes, cooNewRes, docRes] = await Promise.all([
      supabase
        .from('payments')
        .select('subscriber_name, estate_id, property_type, estates(name)')
        .eq('is_deleted', false)
        .ilike('subscriber_name', pattern)
        .limit(30),
      supabase
        .from('offers')
        .select('subscriber_name, estate_id, property_type, estates(name)')
        .eq('is_deleted', false)
        .ilike('subscriber_name', pattern)
        .limit(30),
      supabase
        .from('allocation_records')
        .select('subscriber_name, estate_id, property_type, house_no, estates(name)')
        .eq('is_deleted', false)
        .ilike('subscriber_name', pattern)
        .limit(30),
      supabase
        .from('refunds')
        .select('subscriber_name, estate_id, property_type, amount_approved, estates(name)')
        .eq('is_deleted', false)
        .ilike('subscriber_name', pattern)
        .limit(30),
      supabase
        .from('ownership_changes')
        .select('previous_owner, new_owner, estate_id, property_type, amount_paid, estates(name), allocation_records(estate_id, estates(name)), offers(estate_id, estates(name))')
        .ilike('previous_owner', pattern)
        .limit(30),
      supabase
        .from('ownership_changes')
        .select('previous_owner, new_owner, estate_id, property_type, amount_paid, estates(name), allocation_records(estate_id, estates(name)), offers(estate_id, estates(name))')
        .ilike('new_owner', pattern)
        .limit(30),
      supabase
        .from('documents')
        .select('subscriber_name, estate_id, description, estates(name)')
        .eq('is_deleted', false)
        .ilike('subscriber_name', pattern)
        .limit(30),
    ]);

    const map = new Map();
    function resolveEstate(row) {
      const estateId = row.estate_id
        || row.allocation_records?.estate_id
        || row.offers?.estate_id
        || null;
      const estateName = row.estates?.name
        || row.allocation_records?.estates?.name
        || row.offers?.estates?.name
        || '—';
      return { estateId, estateName };
    }
    function add(name, row, source, extra = {}) {
      const cleaned = String(name || '').trim();
      if (!cleaned) return;
      const { estateId, estateName } = resolveEstate(row);
      // Allow results without estate (still show in list; profile needs estate when possible)
      const key = `${estateId || 'none'}::${cleaned.toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, {
          name: cleaned,
          estateId,
          estateName,
          propertyType: row.property_type || extra.propertyType || null,
          houseNo: row.house_no || extra.houseNo || null,
          sources: new Set([source]),
        });
      } else {
        const rec = map.get(key);
        rec.sources.add(source);
        if (!rec.propertyType && (row.property_type || extra.propertyType)) {
          rec.propertyType = row.property_type || extra.propertyType;
        }
        if (!rec.houseNo && (row.house_no || extra.houseNo)) {
          rec.houseNo = row.house_no || extra.houseNo;
        }
        if (!rec.estateId && estateId) {
          rec.estateId = estateId;
          rec.estateName = estateName;
        }
      }
    }

    (payRes.data || []).forEach((r) => add(r.subscriber_name, r, 'Payment'));
    (offerRes.data || []).forEach((r) => add(r.subscriber_name, r, 'Offer'));
    (allocRes.data || []).forEach((r) => add(r.subscriber_name, r, 'Allocation'));
    (refundRes.data || []).forEach((r) => add(r.subscriber_name, r, 'Refund'));
    (docRes.data || []).forEach((r) => add(r.subscriber_name, r, 'Document'));
    [...(cooPrevRes.data || []), ...(cooNewRes.data || [])].forEach((r) => {
      add(r.previous_owner, r, 'COO (previous)');
      add(r.new_owner, r, 'COO (new)');
    });

    setSearchResults(
      [...map.values()]
        .map((r) => ({ ...r, sources: [...r.sources].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 40)
    );
    setSearching(false);
  }

  async function load() {
    setLoading(true);
    const [poRes, faRes, cooRes, estatesRes, approvalsRes, refundsRes, offersRes, allocRes] = await Promise.all([
      supabase.from('offers').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
      supabase.from('allocation_records').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
      supabase.from('ownership_changes').select('id', { count: 'exact', head: true }),
      supabase.from('estates').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
      supabase.from('approvals_expenditures').select('amount_approved').eq('is_deleted', false),
      supabase.from('refunds').select('amount_approved').eq('is_deleted', false),
      supabase.from('offers').select('estate_id, property_type, estates(name)').eq('is_deleted', false),
      supabase.from('allocation_records').select('estate_id, property_type, estates(name)').eq('is_deleted', false),
    ]);

    const totalApproved = (approvalsRes.data || []).reduce((s, r) => s + Number(r.amount_approved || 0), 0);
    const totalRefunded = (refundsRes.data || []).reduce((s, r) => s + Number(r.amount_approved || 0), 0);

    setStats({
      po: poRes.count || 0,
      fa: faRes.count || 0,
      coo: cooRes.count || 0,
      estates: estatesRes.count || 0,
      totalApproved,
      totalRefunded,
    });

    const estateMap = {};
    const ptMap = {};
    [...(offersRes.data || []), ...(allocRes.data || [])].forEach((r) => {
      const estateName = r.estates?.name || 'Unknown';
      estateMap[estateName] = estateMap[estateName] || { name: estateName, id: r.estate_id, count: 0 };
      estateMap[estateName].count += 1;
      const pt = r.property_type || 'Unspecified';
      ptMap[pt] = (ptMap[pt] || 0) + 1;
    });
    setByEstate(Object.values(estateMap));
    setByPropertyType(Object.entries(ptMap).map(([name, value]) => ({ name, value })));
    setLoading(false);
  }

  if (loading) return <div className="empty-state">Loading dashboard…</div>;

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Dashboard Overview</h2>
          <p className="muted" style={{ margin: '2px 0 0' }}>
            Signed in as <b>{profile?.full_name}</b> · <span className="tag approved">{ROLE_LABELS[profile?.role] || profile?.role}</span>
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, position: 'relative' }}>
        <label>Search across database</label>
        <input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Name — searches payments, offers, allocations, refunds, COO, documents…"
          autoComplete="off"
        />
        {searching && <p className="muted" style={{ marginTop: 6 }}>Searching…</p>}
        {!searching && searchQ.trim().length >= 2 && searchResults.length === 0 && (
          <p className="muted" style={{ marginTop: 6 }}>No matches found.</p>
        )}
        {searchResults.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Estate</th>
                  <th>Property Type</th>
                  <th>Found in</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((r) => {
                  const canOpen = !!r.estateId;
                  const go = () => {
                    if (!canOpen) {
                      alert('This match has no estate linked, so a profile page cannot be opened yet. Link the record to an estate first.');
                      return;
                    }
                    navigate(`/subscriber/${r.estateId}/${encodeURIComponent(r.name)}`);
                  };
                  return (
                    <tr
                      key={`${r.estateId || 'x'}-${r.name}-${r.sources.join(',')}`}
                      onClick={go}
                      style={{ cursor: canOpen ? 'pointer' : 'default' }}
                      title={canOpen ? 'Click to open profile' : 'No estate linked'}
                    >
                      <td>
                        {canOpen ? (
                          <span style={{ color: '#1f8fd6', fontWeight: 600 }}>{r.name}</span>
                        ) : r.name}
                      </td>
                      <td>{r.estateName}</td>
                      <td>{r.propertyType || '—'}{r.houseNo ? ` · ${r.houseNo}` : ''}</td>
                      <td>{r.sources.join(', ')}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {canOpen ? (
                          <button type="button" className="btn btn-primary btn-sm" onClick={go}>
                            Open profile
                          </button>
                        ) : (
                          <span className="muted">No estate</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid cols-4">
        <Link to="/offers" className="stat-card blue" style={{ textDecoration: 'none', cursor: 'pointer' }}>
          <div className="value">{stats.po}</div>
          <div className="label">Provisional Offers Made</div>
        </Link>
        <Link to="/allocations" className="stat-card gold" style={{ textDecoration: 'none', cursor: 'pointer' }}>
          <div className="value">{stats.fa}</div>
          <div className="label">Final Allocations Made</div>
        </Link>
        <Link to="/coo" className="stat-card grey" style={{ textDecoration: 'none', cursor: 'pointer' }}>
          <div className="value">{stats.coo}</div>
          <div className="label">Ownership Changes</div>
        </Link>
        <Link to="/estates" className="stat-card" style={{ textDecoration: 'none', cursor: 'pointer' }}>
          <div className="value">{stats.estates}</div>
          <div className="label">Active Estates</div>
        </Link>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Link to="/approvals" className="stat-card" style={{ textDecoration: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#166534,#22c55e)' }}>
          <div className="value">₦{stats.totalApproved.toLocaleString()}</div>
          <div className="label">Total Approved Expenditure</div>
        </Link>
        <Link to="/refunds" className="stat-card" style={{ textDecoration: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#991b1b,#ef4444)' }}>
          <div className="value">₦{stats.totalRefunded.toLocaleString()}</div>
          <div className="label">Total Refunds Approved</div>
        </Link>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Records by Estate</h3>
          <p className="muted" style={{ marginTop: -8 }}>Click a bar to open that estate.</p>
          {byEstate.length === 0 ? (
            <p className="muted">No data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byEstate}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar
                  dataKey="count"
                  fill="#1f8fd6"
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(data) => data?.id && navigate(`/estates/${data.id}`)}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h3>Records by Property Type</h3>
          {byPropertyType.length === 0 ? (
            <p className="muted">No data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={byPropertyType} dataKey="value" nameKey="name" outerRadius={100} label>
                  {byPropertyType.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Quick Links</h3>
        <div className="flex wrap">
          <Link className="btn btn-outline" to="/offers">Offers Register</Link>
          <Link className="btn btn-outline" to="/allocations">Allocations Register</Link>
          <Link className="btn btn-outline" to="/payments">Payments Register</Link>
          <Link className="btn btn-outline" to="/analysis">Payment Analysis</Link>
          <Link className="btn btn-outline" to="/coo">Ownership Changes (COO)</Link>
          <Link className="btn btn-outline" to="/estates">Manage Estates</Link>
          <Link className="btn btn-outline" to="/approvals">Approvals / Expenditure</Link>
          <Link className="btn btn-outline" to="/refunds">Refunds</Link>
          <Link className="btn btn-outline" to="/documents">Documents</Link>
        </div>
      </div>
    </div>
  );
}

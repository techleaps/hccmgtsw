import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Link } from 'react-router-dom';

const COLORS = ['#1f8fd6', '#c9a24b', '#1e9e5a', '#d9483b', '#8b5cf6', '#0b2545', '#f59e0b', '#0891b2'];
const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', supervisor: 'Supervisor', user: 'User' };

export default function Dashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState(null);
  const [byEstate, setByEstate] = useState([]);
  const [byPropertyType, setByPropertyType] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [poRes, faRes, cooRes, estatesRes, approvalsRes, refundsRes, subsRes] = await Promise.all([
      supabase.from('subscribers').select('id', { count: 'exact', head: true }).eq('offer_made', true).eq('is_deleted', false),
      supabase.from('subscribers').select('id', { count: 'exact', head: true }).eq('allocation_made', true).eq('is_deleted', false),
      supabase.from('ownership_changes').select('id', { count: 'exact', head: true }),
      supabase.from('estates').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
      supabase.from('approvals_expenditures').select('amount_approved').eq('is_deleted', false),
      supabase.from('refunds').select('amount_approved').eq('is_deleted', false),
      supabase.from('subscribers').select('estate_id, property_type, estates(name)').eq('is_deleted', false),
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
    (subsRes.data || []).forEach((r) => {
      const estateName = r.estates?.name || 'Unknown';
      estateMap[estateName] = (estateMap[estateName] || 0) + 1;
      const pt = r.property_type || 'Unspecified';
      ptMap[pt] = (ptMap[pt] || 0) + 1;
    });
    setByEstate(Object.entries(estateMap).map(([name, count]) => ({ name, count })));
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

      <div className="grid cols-4">
        <div className="stat-card blue">
          <div className="value">{stats.po}</div>
          <div className="label">Provisional Offers Made</div>
        </div>
        <div className="stat-card gold">
          <div className="value">{stats.fa}</div>
          <div className="label">Final Allocations Made</div>
        </div>
        <div className="stat-card grey">
          <div className="value">{stats.coo}</div>
          <div className="label">Ownership Changes</div>
        </div>
        <div className="stat-card">
          <div className="value">{stats.estates}</div>
          <div className="label">Active Estates</div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="stat-card" style={{ background: 'linear-gradient(135deg,#166534,#22c55e)' }}>
          <div className="value">₦{stats.totalApproved.toLocaleString()}</div>
          <div className="label">Total Approved Expenditure</div>
        </div>
        <div className="stat-card" style={{ background: 'linear-gradient(135deg,#991b1b,#ef4444)' }}>
          <div className="value">₦{stats.totalRefunded.toLocaleString()}</div>
          <div className="label">Total Refunds Approved</div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Subscribers by Estate</h3>
          {byEstate.length === 0 ? (
            <p className="muted">No subscriber data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byEstate}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#1f8fd6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h3>Subscribers by Property Type</h3>
          {byPropertyType.length === 0 ? (
            <p className="muted">No subscriber data yet.</p>
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
          <Link className="btn btn-outline" to="/subscribers">Subscribers (PO / FA) Register</Link>
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

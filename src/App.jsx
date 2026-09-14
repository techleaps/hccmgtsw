import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useAuth } from './lib/AuthContext';
import { supabase } from './lib/supabaseClient';
import Login from './components/Login';
import ChangePassword from './components/ChangePassword';
import Dashboard from './components/Dashboard';
import EstatesTab from './components/EstatesTab';
import EstateDetail from './components/EstateDetail';
import OffersEstatesTab from './components/OffersEstatesTab';
import OffersTab from './components/OffersTab';
import AllocationsEstatesTab from './components/AllocationsEstatesTab';
import AllocationRecordsTab from './components/AllocationRecordsTab';
import PaymentsEstatesTab from './components/PaymentsEstatesTab';
import PaymentsTab from './components/PaymentsTab';
import SubscriberProfile from './components/SubscriberProfile';
import AnalysisEstatesTab from './components/AnalysisEstatesTab';
import Analysis from './components/Analysis';
import CooLogTab from './components/CooLogTab';
import ApprovalsTab from './components/ApprovalsTab';
import RefundsTab from './components/RefundsTab';
import DocumentsTab from './components/DocumentsTab';
import CustomTabsAdmin from './components/CustomTabsAdmin';
import CustomTabView from './components/CustomTabView';
import UsersAdmin from './components/UsersAdmin';
import AuditLog from './components/AuditLog';
import EditRequests from './components/EditRequests';

export default function App() {
  const { session, profile, loading, signOut, isAdmin, isSupervisorPlus } = useAuth();
  const [customTabs, setCustomTabs] = useState([]);

  useEffect(() => {
    if (!session) return;
    supabase.from('custom_tabs').select('*').eq('is_deleted', false).order('created_at')
      .then(({ data }) => setCustomTabs(data || []));
  }, [session]);

  if (loading) return <div className="empty-state">Loading…</div>;
  if (!session) return <Login />;
  if (!profile) return <div className="empty-state">Setting up your profile… if this persists, ask an admin to check your account.</div>;
  if (profile.must_change_password) return <ChangePassword forced />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.jpeg" alt="logo" />
          <h1>NAFILHCC<br />Admin System</h1>
        </div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/estates">Estates</NavLink>
          <NavLink to="/offers">Offers</NavLink>
          <NavLink to="/allocations">Allocations</NavLink>
          <NavLink to="/payments">Payments</NavLink>
          <NavLink to="/analysis">Payment Analysis</NavLink>
          <NavLink to="/coo">Change of Ownership</NavLink>
          <NavLink to="/approvals">Approvals / Expenditure</NavLink>
          <NavLink to="/refunds">Refunds</NavLink>
          <NavLink to="/documents">Documents</NavLink>
          {customTabs.map((t) => (
            <NavLink key={t.id} to={`/tab/${t.tab_key}`}>{t.label}</NavLink>
          ))}
          <NavLink to="/edit-requests">Edit/Delete Requests</NavLink>
          {isAdmin && <NavLink to="/custom-tabs">Custom Tabs</NavLink>}
          {isAdmin && <NavLink to="/users">Users &amp; Access</NavLink>}
          {isSupervisorPlus && <NavLink to="/audit-log">Audit Log</NavLink>}
        </nav>
      </aside>

      <div className="main">
        <div className="topbar">
          <div />
          <div className="who">
            Signed in as <b>{profile.full_name}</b>
            <span className={`role-badge ${profile.role}`}>{profile.role.replace('_', ' ')}</span>
            <button className="btn btn-outline btn-sm" style={{ marginLeft: 14 }} onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/estates" element={<EstatesTab />} />
            <Route path="/estates/:id" element={<EstateDetail />} />
            <Route path="/offers" element={<OffersEstatesTab />} />
            <Route path="/offers/:estateId" element={<OffersTab />} />
            <Route path="/allocations" element={<AllocationsEstatesTab />} />
            <Route path="/allocations/:estateId" element={<AllocationRecordsTab />} />
            <Route path="/payments" element={<PaymentsEstatesTab />} />
            <Route path="/payments/:estateId" element={<PaymentsTab />} />
            <Route path="/subscriber/:estateId/:name" element={<SubscriberProfile />} />
            <Route path="/analysis" element={<AnalysisEstatesTab />} />
            <Route path="/analysis/:estateId" element={<Analysis />} />
            <Route path="/coo" element={<CooLogTab />} />
            <Route path="/approvals" element={<ApprovalsTab />} />
            <Route path="/refunds" element={<RefundsTab />} />
            <Route path="/documents" element={<DocumentsTab />} />
            <Route path="/tab/:tabKey" element={<CustomTabView />} />
            <Route path="/custom-tabs" element={<CustomTabsAdmin onTabsChanged={() => supabase.from('custom_tabs').select('*').eq('is_deleted', false).order('created_at').then(({ data }) => setCustomTabs(data || []))} />} />
            <Route path="/edit-requests" element={<EditRequests />} />
            <Route path="/users" element={<UsersAdmin />} />
            <Route path="/audit-log" element={<AuditLog />} />
            <Route path="/account/change-password" element={<ChangePassword />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

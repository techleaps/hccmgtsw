import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';

const BLANK = { username: '', password: '', full_name: '', role: 'user', supervisor_id: '' };

export default function UsersAdmin() {
  const { profile, isSuperAdmin, session } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [createdInfo, setCreatedInfo] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    setUsers(data || []);
    setLoading(false);
  }

  const supervisors = users.filter((u) => ['supervisor', 'admin', 'super_admin'].includes(u.role));

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!form.username || !form.password || !form.full_name) { setError('Username, password and full name are required.'); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: form,
    });
    setSaving(false);
    if (error || data?.error) { setError(data?.error || error.message); return; }
    setShowModal(false);
    setCreatedInfo({ username: form.username, password: form.password, full_name: form.full_name });
    setForm(BLANK);
    load();
  }

  async function toggleActive(u) {
    await supabase.from('profiles').update({ is_active: !u.is_active }).eq('id', u.id);
    load();
  }

  async function changeRole(u, role) {
    if (!isSuperAdmin && ['admin', 'super_admin'].includes(role)) {
      alert('Only a super admin can assign admin/super admin roles.');
      return;
    }
    await supabase.from('profiles').update({ role }).eq('id', u.id);
    load();
  }

  async function changeSupervisor(u, supervisor_id) {
    await supabase.from('profiles').update({ supervisor_id: supervisor_id || null }).eq('id', u.id);
    load();
  }

  async function resetToForceChange(u) {
    if (!confirm(`Force ${u.full_name} to set a new password on their next sign-in?`)) return;
    await supabase.from('profiles').update({ must_change_password: true }).eq('id', u.id);
    load();
  }

  return (
    <div>
      <div className="page-title">
        <h2>Users &amp; Access</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Create User</button>
      </div>

      <div className="card">
        <p className="muted">
          Roles: <b>Super Admin</b> (full rights, only role that can create other admins) · <b>Admin</b> (manage users, estates, records, approve edits)
          · <b>Supervisor</b> (manages assigned users, approves their edit/delete requests) · <b>User</b> (enters records; edits/deletes need approval).
          Accounts sign in with a <b>username</b> (no email needed) and must set their own password the first time they sign in.
        </p>
      </div>

      {createdInfo && (
        <div className="card" style={{ borderLeft: '4px solid #1e9e5a' }}>
          <h4 style={{ marginTop: 0 }}>Account created for {createdInfo.full_name}</h4>
          <p>Give them these sign-in details. They will be asked to set their own password the first time they sign in.</p>
          <p><b>Username:</b> {createdInfo.username} &nbsp; <b>Temporary Password:</b> {createdInfo.password}</p>
          <button className="btn btn-outline btn-sm" onClick={() => setCreatedInfo(null)}>Dismiss</button>
        </div>
      )}

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr><th>Name</th><th>Username</th><th>Role</th><th>Supervisor</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.username || <span className="muted">—</span>}</td>
                  <td>
                    <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} disabled={u.id === profile.id}>
                      <option value="user">User</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="admin">Admin</option>
                      {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                    </select>
                  </td>
                  <td>
                    <select value={u.supervisor_id || ''} onChange={(e) => changeSupervisor(u, e.target.value)} disabled={u.id === profile.id}>
                      <option value="">— None —</option>
                      {supervisors.filter((s) => s.id !== u.id).map((s) => (
                        <option key={s.id} value={s.id}>{s.full_name}</option>
                      ))}
                    </select>
                  </td>
                  <td>{u.is_active ? <span className="tag approved">Active</span> : <span className="tag rejected">Disabled</span>}</td>
                  <td>
                    <div className="flex wrap">
                      <button className="btn btn-outline btn-sm" onClick={() => toggleActive(u)} disabled={u.id === profile.id}>
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => resetToForceChange(u)}>Force Password Reset</button>
                      <Link className="btn btn-outline btn-sm" to={`/documents?user=${u.id}`}>Documents</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New User</h3>
            <form onSubmit={handleCreate}>
              <div className="field"><label>Full Name</label><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
              <div className="field">
                <label>Username</label>
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. jane.doe" required />
              </div>
              <div className="field"><label>Temporary Password</label><input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
              <div className="field">
                <label>Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="user">User</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                  {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                </select>
              </div>
              <div className="field">
                <label>Assign to Supervisor (optional)</label>
                <select value={form.supervisor_id} onChange={(e) => setForm({ ...form, supervisor_id: e.target.value })}>
                  <option value="">— None —</option>
                  {supervisors.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create User'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

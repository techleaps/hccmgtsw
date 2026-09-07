import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';

export default function ChangePassword({ forced }) {
  const { profile, refreshProfile, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSaving(true);
    const { error: pwError } = await supabase.auth.updateUser({ password });
    if (pwError) { setSaving(false); setError(pwError.message); return; }
    await supabase.from('profiles').update({ must_change_password: false }).eq('id', profile.id);
    setSaving(false);
    await refreshProfile();
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src="/logo.jpeg" alt="NAFILHCC" />
        <h2>{forced ? 'Set Your Password' : 'Change Password'}</h2>
        {forced && (
          <p className="sub">
            This is your first sign-in. For security, please choose your own password before continuing.
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <div className="field" style={{ textAlign: 'left' }}>
            <label>New Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="field" style={{ textAlign: 'left' }}>
            <label>Confirm New Password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={saving}>
            {saving ? 'Saving…' : 'Save Password'}
          </button>
        </form>
        {forced && (
          <p className="muted" style={{ marginTop: 16, cursor: 'pointer' }} onClick={signOut}>
            Sign out instead
          </p>
        )}
      </div>
    </div>
  );
}

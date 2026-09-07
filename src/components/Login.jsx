import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';

export default function Login() {
  const { idleSignedOut, clearIdleFlag } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    clearIdleFlag();

    // The office only ever sees a username; we resolve it to the internal
    // login email behind the scenes before calling Supabase Auth.
    const { data: email, error: lookupError } = await supabase.rpc('get_login_email', {
      p_username: username.trim(),
    });
    if (lookupError || !email) {
      setLoading(false);
      setError('Incorrect username or password.');
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError('Incorrect username or password.');
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src="/logo.jpeg" alt="NAFILHCC" />
        <h2>NAFILHCC Admin System</h2>
        <p className="sub">NAFIL Housing &amp; Construction Company</p>
        {idleSignedOut && (
          <div className="error-text" style={{ marginBottom: 12 }}>
            You were signed out after a period of inactivity, to keep this account secure. Please sign in again.
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="field" style={{ textAlign: 'left' }}>
            <label>Username</label>
            <input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ textAlign: 'left' }}>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          No account? Ask your Administrator to create one for you.
        </p>
      </div>
    </div>
  );
}

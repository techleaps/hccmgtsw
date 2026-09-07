import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext(null);

// Idle timeout: sign the user out after this many milliseconds of no
// mouse/keyboard/touch activity, so an unattended, signed-in screen
// cannot be read or used by someone else in the office.
const IDLE_TIMEOUT_MS = 60 * 1000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [idleSignedOut, setIdleSignedOut] = useState(false);
  const idleTimer = useRef(null);

  async function loadProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile(data || null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) loadProfile(session.user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) loadProfile(session.user.id);
      else setProfile(null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ---- idle timeout ----
  useEffect(() => {
    if (!session) return;

    function resetTimer() {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(async () => {
        setIdleSignedOut(true);
        await supabase.auth.signOut();
      }, IDLE_TIMEOUT_MS);
    }

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimer));
    resetTimer();

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetTimer));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [session]);

  const value = {
    session,
    user: session?.user || null,
    profile,
    loading,
    idleSignedOut,
    clearIdleFlag: () => setIdleSignedOut(false),
    isSuperAdmin: profile?.role === 'super_admin',
    isAdmin: profile?.role === 'admin' || profile?.role === 'super_admin',
    isSupervisorPlus: ['super_admin', 'admin', 'supervisor'].includes(profile?.role),
    signOut: () => supabase.auth.signOut(),
    refreshProfile: () => session?.user && loadProfile(session.user.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

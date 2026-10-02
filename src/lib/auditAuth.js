import { supabase } from './supabaseClient';

/**
 * Write an authentication / session event into audit_logs.
 * Uses security-definer RPC first (bypasses RLS), then direct insert fallback.
 */
export async function logAuthEvent({
  action, // LOGIN | LOGOUT | LOGIN_FAILED | PASSWORD_CHANGE | IDLE_LOGOUT
  userId = null,
  summary = null,
  extra = {},
}) {
  const newData = {
    ...extra,
    at: new Date().toISOString(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  };
  try {
    const { data, error } = await supabase.rpc('log_audit_event', {
      p_table_name: 'auth_sessions',
      p_action: action,
      p_record_id: userId || null,
      p_summary: summary || action,
      p_new_data: newData,
      p_old_data: null,
      p_performed_by: userId || null,
      p_source: 'client_auth',
    });
    if (!error) return data;
    console.warn('audit RPC failed, trying insert', error.message);
  } catch (err) {
    console.warn('audit RPC exception', err);
  }
  try {
    const { error } = await supabase.from('audit_logs').insert({
      table_name: 'auth_sessions',
      record_id: userId || null,
      action,
      old_data: null,
      new_data: newData,
      performed_by: userId || null,
      summary: summary || action,
      source: 'client_auth',
    });
    if (error) console.warn('audit insert failed', error.message);
  } catch (err) {
    console.warn('audit insert exception', err);
  }
}

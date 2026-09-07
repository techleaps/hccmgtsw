// Supabase Edge Function: admin-create-user
// Deploy with: supabase functions deploy admin-create-user
// Runs server-side with the SERVICE ROLE key (never exposed to the browser).
// Only callers whose own profile role is 'admin' or 'super_admin' may call this.
//
// v2: accounts are created with a USERNAME + PASSWORD (no email needed from
// the office's point of view). Internally, Supabase Auth still requires an
// email address, so we generate an invisible one as "<username>@LOGIN_DOMAIN"
// — the person never sees or uses it, they just type their username.
// New accounts are always created with must_change_password = true, so the
// person is forced to set their own password the first time they sign in.

import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Any fixed, non-existent domain works — it is never emailed or shown.
const LOGIN_DOMAIN = Deno.env.get('LOGIN_EMAIL_DOMAIN') || 'login.nafilhcc.internal';

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller) throw new Error('Invalid session');

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', caller.id).single();
    if (!callerProfile || !['admin', 'super_admin'].includes(callerProfile.role)) {
      throw new Error('Only admins can create users');
    }

    const { username, password, full_name, role, supervisor_id } = await req.json();
    if (!username || !password || !full_name) throw new Error('username, password, and full_name are required');
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
      throw new Error('Username must be 3-32 characters: letters, numbers, dots, dashes or underscores only');
    }
    if (!['super_admin', 'admin', 'supervisor', 'user'].includes(role)) throw new Error('Invalid role');
    if (['admin', 'super_admin'].includes(role) && callerProfile.role !== 'super_admin') {
      throw new Error('Only a super admin can create admin accounts');
    }

    const { data: existing } = await admin.from('profiles').select('id').ilike('username', username).maybeSingle();
    if (existing) throw new Error('That username is already taken');

    const internalEmail = `${username.toLowerCase()}@${LOGIN_DOMAIN}`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name, username, role },
    });
    if (createError) throw createError;

    await admin.from('profiles').update({
      role,
      supervisor_id: supervisor_id || null,
      full_name,
      username,
      must_change_password: true,
    }).eq('id', created.user.id);

    return new Response(JSON.stringify({ success: true, user_id: created.user.id, username }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

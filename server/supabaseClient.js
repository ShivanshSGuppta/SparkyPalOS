import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim() || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim() || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && (supabaseServiceRoleKey || supabaseAnonKey));
}

export function getSupabaseAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function getSupabaseAnonClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function validateSupabaseBearerToken(token = '') {
  if (!token) return { ok: false, reason: 'missing_token' };

  const admin = getSupabaseAdminClient();
  if (admin) {
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data?.user) {
      return { ok: true, user: data.user, source: 'service_role' };
    }
  }

  const anon = getSupabaseAnonClient();
  if (anon) {
    const { data, error } = await anon.auth.getUser(token);
    if (!error && data?.user) {
      return { ok: true, user: data.user, source: 'anon' };
    }
  }

  return { ok: false, reason: 'invalid_token' };
}

export function getPublicClientConfig() {
  return {
    supabaseUrl,
    supabaseAnonKey,
    posthogKey: process.env.POSTHOG_KEY?.trim() || '',
    posthogHost: process.env.POSTHOG_HOST?.trim() || 'https://us.i.posthog.com',
    sentryDsn: process.env.SENTRY_DSN_PUBLIC?.trim() || ''
  };
}

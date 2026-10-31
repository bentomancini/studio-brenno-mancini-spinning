import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env, serviceKey } from './env';

export type AuthScope = 'normal' | 'recovery';
export const cookieName = (scope: AuthScope) => scope === 'normal' ? 'studio-auth' : 'studio-recovery';
export async function serverClient(scope: AuthScope = 'normal') {
  const config = env(); const jar = await cookies();
  return createServerClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { name: cookieName(scope), httpOnly: true, secure: config.APP_ENV === 'production', sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: values => { for (const { name, value, options } of values) jar.set(name, value, { ...options, httpOnly: true, secure: config.APP_ENV === 'production', sameSite: 'lax', path: '/' }); },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: init?.signal ?? AbortSignal.timeout(15000) }) },
  });
}
// Only Auth/rate-limit/invitation bridge uses this client. Never reservations.
export function authAdminClient() {
  const config = env();
  return createClient(config.SUPABASE_URL, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: init?.signal ?? AbortSignal.timeout(15000) }) },
  });
}
export async function clearAuthCookies(scope: AuthScope) {
  const jar = await cookies(); const prefix = cookieName(scope);
  for (const cookie of jar.getAll()) {
    if (cookie.name === prefix || cookie.name.startsWith(`${prefix}.`) || cookie.name.startsWith(`${prefix}-`)) {
      jar.set(cookie.name, '', { httpOnly: true, secure: env().APP_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
    }
  }
}

import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SessionIdentity } from '@/contracts';
import { env } from './env';
import { cookieName } from './supabase';
import { rpc } from './rpc';
import { ApiError } from './errors';
import { loginHref } from '@/lib/ui/navigation';

// Proxy refreshes HttpOnly cookies. RSC is deliberately read-only; no cookie writes
// are swallowed in the existing BFF's cookie adapter.
export async function pageIdentity(admin: boolean, path: string): Promise<SessionIdentity> {
  const config = env(); const jar = await cookies();
  const client = createServerClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { name: cookieName('normal'), httpOnly: true, secure: config.APP_ENV === 'production', sameSite: 'lax', path: '/' },
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: init?.signal ?? AbortSignal.timeout(15000) }) },
  });
  const { data, error } = await client.auth.getUser();
  if (error?.status && error.status >= 500 || error && !data.user && error.name !== 'AuthSessionMissingError' && !error.status) throw new ApiError(503, 'SERVICE_UNAVAILABLE');
  if (!data.user || error) redirect(loginHref(path));
  let identity: SessionIdentity;
  try { identity = await rpc<SessionIdentity>(client, 'studio_session', { p_action: 'check' }); }
  catch (error) { if (error instanceof ApiError && error.status === 401) redirect(loginHref(path)); throw error; }
  if (identity.userId !== data.user.id) redirect(loginHref(path));
  const email = data.user.email?.toLowerCase();
  const isAllowedAdmin = email === 'bentomancini@gmail.com' || (config.APP_ENV === 'test' && email?.endsWith('@example.invalid'));
  if (admin && (identity.role !== 'admin' || !isAllowedAdmin)) throw new ApiError(403, 'FORBIDDEN');
  return identity;
}

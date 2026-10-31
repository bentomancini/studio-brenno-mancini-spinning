import 'server-only';
import { createHmac } from 'node:crypto';
import { decodeJwt } from 'jose';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { SessionIdentity } from '@/contracts';
import { ApiError } from '@/lib/server/errors';
import { env } from '@/lib/server/env';
import { rpc } from '@/lib/server/rpc';
import { authAdminClient, clearAuthCookies, serverClient, type AuthScope } from '@/lib/server/supabase';

export async function authenticated(admin = false) {
  const client = await serverClient();
  const { data, error } = await client.auth.getUser(); // Network validation; never authorize getSession() alone.
  if (error || !data.user) throw new ApiError(401, 'UNAUTHENTICATED');
  const identity = await rpc<SessionIdentity>(client, 'studio_session', { p_action: 'check' });
  if (identity.userId !== data.user.id) throw new ApiError(401, 'UNAUTHENTICATED');
  const email = data.user.email?.toLowerCase();
  const isAllowedAdmin = email === 'bentomancini@gmail.com' || (env().APP_ENV === 'test' && email?.endsWith('@example.invalid'));
  if (admin && (identity.role !== 'admin' || !isAllowedAdmin)) throw new ApiError(403, 'FORBIDDEN');
  return { client, identity, user: data.user };
}
export async function establish(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError(401, 'UNAUTHENTICATED');
  try {
    const identity = await rpc<SessionIdentity>(client, 'studio_session', { p_action: 'register' });
    if (identity.userId !== data.user.id) throw new ApiError(401, 'UNAUTHENTICATED');
    return identity;
  }
  catch (error) { await clearAuthCookies('normal'); throw error; }
}
export async function verifiedSession(client: SupabaseClient, invalidCode = 'RECOVERY_INVALID'): Promise<{ user: User; sessionId: string }> {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError(401, invalidCode);
  // getSession supplies the already server-validated JWT, not an authorization decision.
  const { data: session } = await client.auth.getSession();
  if (!session.session) throw new ApiError(401, invalidCode);
  const claims = decodeJwt(session.session.access_token);
  if (claims.sub !== data.user.id || typeof claims.session_id !== 'string' || !claims.exp || claims.exp <= Date.now() / 1000) throw new ApiError(401, invalidCode);
  return { user: data.user, sessionId: claims.session_id };
}
export async function grantRecovery(client: SupabaseClient) {
  const { user, sessionId } = await verifiedSession(client);
  await rpc(authAdminClient(), 'studio_auth_bridge', { p_action: 'recovery_grant', p_body: { userId: user.id, sessionId } });
}
export async function resetWithRecovery(password: string) {
  const client = await serverClient('recovery');
  const { user, sessionId } = await verifiedSession(client); const admin = authAdminClient();
  // Consume before the external call. A failed provider update requires a NEW recovery.
  await rpc(admin, 'studio_auth_bridge', { p_action: 'consume_recovery', p_body: { userId: user.id, sessionId } });
  await rpc(admin, 'studio_auth_bridge', { p_action: 'revoke_user', p_body: { userId: user.id } });
  const { error } = await client.auth.updateUser({ password });
  // Cover sessions registered during the external password-update gap as well.
  await rpc(admin, 'studio_auth_bridge', { p_action: 'revoke_user', p_body: { userId: user.id } });
  await client.auth.signOut({ scope: 'global' });
  await clearAuthCookies('recovery'); await clearAuthCookies('normal');
  if (error) throw new ApiError(error.status && error.status < 500 ? 422 : 503, 'PASSWORD_UPDATE_FAILED_RESTART_RECOVERY');
  return { changed: true, signInRequired: true };
}
export async function logout() {
  const client = await serverClient(); const { data, error } = await client.auth.getUser();
  if (!error && data.user) await rpc(client, 'studio_session', { p_action: 'revoke' });
  else if (error?.name !== 'AuthSessionMissingError') throw new ApiError(503, 'SERVICE_UNAVAILABLE');
  // DB revocation precedes provider signOut. Previously issued JWTs cannot re-register.
  await client.auth.signOut({ scope: 'local' });
  await clearAuthCookies('normal'); await clearAuthCookies('recovery');
  return { revoked: true };
}
export async function authRateLimit(request: Request, action: string, email?: string) {
  env(); const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32) throw new ApiError(503, 'RATE_LIMIT_NOT_CONFIGURED');
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  const ip = header ? request.headers.get(header)?.slice(0, 128) ?? 'unknown' : 'unknown';
  const admin = authAdminClient();
  // Per-IP and per-address buckets are separate, preventing address rotation bypass.
  for (const [kind, identifier, limit] of [['ip', ip, 30], ...(email ? [['email', email.toLowerCase(), 6]] : [])] as [string, string, number][]) {
    const bucket = createHmac('sha256', secret).update(`${action}:${kind}:${identifier}`).digest('hex');
    const result = await rpc<{ allowed: boolean }>(admin, 'studio_auth_bridge', { p_action: 'rate_limit', p_body: { bucket, limit, seconds: 60 } });
    if (!result.allowed) throw new ApiError(429, 'RATE_LIMITED');
  }
}
export async function clearScope(scope: AuthScope) { await clearAuthCookies(scope); }

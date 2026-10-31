import 'server-only';
import { z } from 'zod';
import * as C from '@/contracts';
import { ApiError } from './errors';
import { env } from './env';
import { body, endpoint, expectedActor, version } from './http';
import { rpc } from './rpc';
import { authAdminClient, clearAuthCookies, serverClient } from './supabase';
import { authenticated, authRateLimit, establish, grantRecovery, logout, resetWithRecovery, verifiedSession } from '@/modules/identity/service';
import { bookingCommand } from '@/modules/bookings/service';

export function parseQuery(request: Request, allowed: string[]) {
  const search = new URL(request.url).searchParams;
  const values: Record<string, string> = {};
  for (const [key, value] of search) {
    if (!allowed.includes(key) || key in values) throw new ApiError(422, 'INVALID_QUERY');
    values[key] = value;
  }
  return C.listQuery.parse(values);
}
async function emptyBody(request: Request) { return request.body ? body(request, C.empty) : {}; }
function id(value: string) { return C.uuid.parse(value); }
function key(request: Request) { return C.operationKey.parse(request.headers.get('idempotency-key') ?? ''); }

async function authRoute(request: Request, action: string) {
  if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
  if (action === 'signup') {
    const input = await body(request, C.signup); await authRateLimit(request, 'signup', input.email);
    await clearAuthCookies('recovery');
    const client = await serverClient();
    const { data, error } = await client.auth.signUp({ email: input.email, password: input.password, options: { data: { full_name: input.fullName }, emailRedirectTo: `${env().APP_ORIGIN}/auth/callback` } });
    if (error && !['user_already_exists', 'email_exists'].includes(error.code ?? '')) throw new ApiError(error.status && error.status < 500 ? 422 : 503, 'SIGNUP_FAILED');
    if (data.session) await establish(client);
    return { accepted: true, message: 'Se necessário, confira seu e-mail para confirmar o cadastro.' };
  }
  if (action === 'login') {
    const input = await body(request, C.credentials); await authRateLimit(request, 'login', input.email);
    await clearAuthCookies('recovery');
    const client = await serverClient();
    const { error } = await client.auth.signInWithPassword(input);
    if (error) throw new ApiError(error.status && error.status >= 500 ? 503 : 401, 'INVALID_CREDENTIALS');
    return establish(client);
  }
  if (action === 'recovery') {
    const input = await body(request, C.recovery); await authRateLimit(request, 'recovery', input.email);
    // A dedicated PKCE cookie namespace is used ONLY by this recovery initiation.
    await clearAuthCookies('recovery');
    const client = await serverClient('recovery');
    const { error } = await client.auth.resetPasswordForEmail(input.email, { redirectTo: `${env().APP_ORIGIN}/auth/callback?flow=recovery` });
    if (error && (!error.status || error.status >= 500)) throw new ApiError(503, 'RECOVERY_UNAVAILABLE');
    // Uniform response for nonexistent, disabled and valid addresses/provider anti-abuse errors.
    return { accepted: true, message: 'Se a conta puder receber recuperação, enviaremos as instruções.' };
  }
  if (action === 'reset-password') {
    const input = await body(request, C.resetPassword); await authRateLimit(request, 'reset-password');
    return resetWithRecovery(input.password);
  }
  if (action === 'confirm') {
    const input = await body(request, C.confirmation); await authRateLimit(request, 'confirm');
    const scope = input.type === 'recovery' ? 'recovery' : 'normal';
    const client = await serverClient(scope);
    const { error } = await client.auth.verifyOtp({ token_hash: input.tokenHash, type: input.type });
    if (error) { await clearAuthCookies(scope); throw new ApiError(401, 'CONFIRMATION_INVALID'); }
    if (scope === 'recovery') { await grantRecovery(client); return { recoveryVerified: true }; }
    return establish(client);
  }
  if (action === 'logout') { await emptyBody(request); return logout(); }
  throw new ApiError(404, 'NOT_FOUND');
}

export async function dispatch(request: Request, path: string[]): Promise<unknown> {
  const method = request.method;
  if (path[0] === 'auth' && path.length === 2) return authRoute(request, path[1]);
  const admin = path[0] === 'admin';
  const { client, identity, user } = await authenticated(admin);
  const privateMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && ['me', 'reservations', 'admin'].includes(path[0]);
  // Check the form/intent owner before parsing its body, consuming a key, or external effects.
  const boundActor = privateMutation ? expectedActor(request, identity.userId) : null;
  const read = (resource: string, resourceId: string | null = null, query: unknown = {}) => rpc(client, 'studio_read', { p_resource: resource, p_id: resourceId, p_query: query });
  const command = (action: string, input: unknown, resourceId: string | null = null, v: number | null = null) => rpc(client, 'studio_command', { p_action: action, p_id: resourceId, p_body: input, p_version: v, p_expected_actor: boundActor }, true);
  if (path.length === 1 && path[0] === 'session' && method === 'GET') return identity;
  if (path.length === 1 && path[0] === 'me') {
    if (method === 'GET') return { ...await read('me'), email: user.email ?? null };
    if (method === 'PATCH') return { ...await command('me.update', await body(request, C.profileUpdate), null, version(request)), email: user.email ?? null };
  }
  if (path[0] === 'me' && path[1] === 'operations' && path.length === 3 && method === 'GET') return read('operations', null, { key: C.operationKey.parse(path[2]) });
  if (path.join('/') === 'me/reservations' && method === 'GET') return read('reservations', null, parseQuery(request, ['limit', 'offset', 'history', 'sessionId']));
  if (path[0] === 'sessions' && method === 'GET') {
    if (path.length === 1) return read('sessions', null, parseQuery(request, ['limit', 'offset', 'from', 'to']));
    if (path.length === 2) return read('sessions', id(path[1]));
    if (path.length === 3 && path[2] === 'bikes') return read('session_bikes', id(path[1]));
  }
  if (path[0] === 'reservations') {
    if (path.length === 1 && method === 'POST') return bookingCommand(client, 'reserve', await body(request, C.reservationCreate), key(request), boundActor!);
    if (path.length === 2 && method === 'GET') return read('reservations', id(path[1]));
    if (path.length === 3 && path[2] === 'cancel' && method === 'POST') return bookingCommand(client, 'cancel', await emptyBody(request), key(request), boundActor!, id(path[1]));
  }
  if (admin) {
    const resource = path[1];
    if (resource === 'settings' && path.length === 2) {
      if (method === 'GET') return read('admin.settings');
      if (method === 'PATCH') return command('admin.settings.update', await body(request, C.settingsUpdate), null, version(request));
    }
    if (resource === 'reservations' || resource === 'attendance') {
      if (path.length === 2 && method === 'GET') return read('admin.reservations', null, parseQuery(request, ['limit', 'offset', 'sessionId', 'studentId', 'history']));
      if (resource === 'reservations' && path.length === 2 && method === 'POST') return bookingCommand(client, 'admin.reserve', await body(request, C.adminReservationCreate), key(request), boundActor!);
      if (resource === 'reservations' && path.length === 3 && method === 'GET') return read('admin.reservations', id(path[2]));
      if (resource === 'reservations' && path.length === 4) {
        if (path[3] === 'cancel' && method === 'POST') return bookingCommand(client, 'admin.cancel', await emptyBody(request), key(request), boundActor!, id(path[2]));
        if (path[3] === 'attendance' && method === 'PUT') return command('admin.attendance.mark', await body(request, C.attendanceMark), id(path[2]), version(request));
        if (path[3] === 'attendance' && method === 'DELETE') return command('admin.attendance.clear', await emptyBody(request), id(path[2]), version(request));
      }
    }
    if (resource === 'students' && path.length === 4 && path[3] === 'invite' && method === 'POST') {
      await emptyBody(request); const v = version(request);
      const student = await read('admin.students', id(path[2]));
      if (student.version !== v) throw new ApiError(409, 'VERSION_CONFLICT');
      if (student.userId || student.invited || student.archivedAt || typeof student.contactEmail !== 'string') throw new ApiError(409, 'INVITATION_NOT_AVAILABLE');
      const proof = await verifiedSession(client, 'UNAUTHENTICATED');
      if (proof.user.id !== identity.userId) throw new ApiError(409, 'ACTOR_CHANGED');
      await authRateLimit(request, 'invite', student.contactEmail);
      const authAdmin = authAdminClient();
      const { data, error } = await authAdmin.auth.admin.inviteUserByEmail(student.contactEmail, { redirectTo: `${env().APP_ORIGIN}/auth/confirm` });
      if (error || !data.user) throw new ApiError(503, 'INVITATION_PROVIDER_FAILED');
      // External delivery and local linkage are not one distributed transaction.
      // If linkage fails, fail closed: operator must reconcile the returned Auth identity privately.
      await rpc(authAdmin, 'studio_auth_bridge', { p_action: 'link_invitation', p_body: { studentId: student.id, userId: data.user.id, version: v, expectedActor: boundActor, requestSessionId: proof.sessionId } });
      return { invited: true, activationRequired: true };
    }
    const schemas: Record<string, { create: z.ZodType; update: z.ZodType }> = {
      students: { create: C.studentCreate, update: C.studentUpdate }, instructors: { create: C.instructorCreate, update: C.instructorUpdate },
      bikes: { create: C.bikeCreate, update: C.bikeUpdate }, sessions: { create: C.sessionCreate, update: C.sessionUpdate },
    };
    if (schemas[resource]) {
      if (path.length === 2 && method === 'GET') return read(`admin.${resource}`, null, parseQuery(request, resource === 'sessions' ? ['limit', 'offset', 'from', 'to'] : ['limit', 'offset']));
      if (path.length === 3 && method === 'GET') return read(`admin.${resource}`, id(path[2]));
      if (path.length === 2 && method === 'POST') return command(`admin.${resource}.create`, await body(request, schemas[resource].create));
      if (path.length === 3 && method === 'PATCH') return command(`admin.${resource}.update`, await body(request, schemas[resource].update), id(path[2]), version(request));
      if (path.length === 3 && method === 'DELETE') return command(`admin.${resource}.archive`, await emptyBody(request), id(path[2]), version(request));
    }
  }
  throw new ApiError(404, 'NOT_FOUND');
}

export function handle(request: Request, path: string[]) {
  return endpoint(request, () => dispatch(request, path));
}

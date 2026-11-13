// ISOLATED TEST HARNESS ONLY. Controlled Auth HTTP provider, NOT GoTrue/SMTP.
// The BFF, SSR guards, cookies, and ORIGINAL SQL migrations run unchanged.
// Never import this module from src or run it against a remote DB.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { TestPostgres, type Actor } from '../helpers/postgres';

const require = createRequire(import.meta.url); const db = new TestPostgres(); await db.start();
async function command(actor: Actor, action: string, body: unknown = {}, id: string | null = null, key: string | null = null, version: number | null = null, expectedActor: string | null = actor.userId) {
  return db.as(actor, async client => (await client.query('select public.studio_command(p_action => $1, p_id => $2, p_body => $3::jsonb, p_key => $4, p_version => $5, p_expected_actor => $6::uuid) result', [action, id, JSON.stringify(body), key, version, expectedActor])).rows[0].result);
}
const accounts = new Map<string, { actor: Actor; password: string; name: string }>();
for (const [email, role, name] of [['student-ui@example.invalid', 'student', 'TEST · Aluno UI'], ['admin-ui@example.invalid', 'admin', 'TEST · Admin UI']] as const) {
  const actor = await db.actor(role, { full_name: name });
  await db.rows('update auth.users set email=$1 where id=$2', [email, actor.userId]);
  accounts.set(email, { actor, password: 'test-browser-password-123', name });
}
const admin = accounts.get('admin-ui@example.invalid')!.actor;
const settings = await db.read(admin, 'admin.settings');
const testPolicies = { bookingWindow: { mode: 'unrestricted' }, cancellation: { mode: 'unrestricted' }, eligibility: { mode: 'unrestricted' }, adminOnBehalf: { mode: 'unrestricted' } };
await command(admin, 'admin.settings.update', { policies: testPolicies }, null, null, settings.version as number);
const instructor = await command(admin, 'admin.instructors.create', { name: 'TEST · Instrutor de contrato' });
const bikes = await Promise.all(['TEST-B01', 'TEST-B02', 'TEST-B03'].map(label => command(admin, 'admin.bikes.create', { label })));
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setUTCHours(18, 0, 0, 0);
const session = await command(admin, 'admin.sessions.create', { title: 'TEST · Aula de integração UI', instructorId: instructor.id, startsAt: tomorrow.toISOString(), endsAt: new Date(tomorrow.getTime() + 2700000).toISOString(), timezone: 'America/Sao_Paulo', capacity: 3, bikeMode: 'required', bikeIds: bikes.map(bike => bike.id), status: 'published' });
const sessionsByToken = new Map<string, { actor: Actor; email: string }>();
function user(email: string, actor: Actor) { return { id: actor.userId, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { full_name: accounts.get(email)?.name }, created_at: new Date().toISOString(), identities: [] }; }
async function grant(email: string) {
  const account = accounts.get(email)!; const actor = { ...account.actor, sessionId: randomUUID() };
  await db.rows('insert into auth.sessions(id,user_id) values($1,$2)', [actor.sessionId, actor.userId]);
  const access_token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actor.userId, session_id: actor.sessionId, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), aud: 'authenticated', role: 'authenticated' })).toString('base64url')}.test-signature-not-gotrue`;
  sessionsByToken.set(access_token, { actor, email });
  return { access_token, refresh_token: `test-refresh-${randomUUID()}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: user(email, actor) };
}
const provider = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store');
  const send = (status: number, body: unknown) => { response.statusCode = status; response.end(JSON.stringify(body)); };
  try {
    const url = new URL(request.url!, 'http://127.0.0.1:3211');
    let raw = ''; for await (const chunk of request) raw += chunk.toString(); const body = raw ? JSON.parse(raw) : {};
    const auth = sessionsByToken.get((request.headers.authorization ?? '').replace(/^Bearer /i, ''));
    if (url.pathname === '/__test/state') return send(200, { sessionId: session.id, bikeIds: bikes.map(bike => bike.id), startsAt: session.startsAt, instructorId: instructor.id, studentId: accounts.get('student-ui@example.invalid')!.actor.studentId });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') { const account = accounts.get(body.email); return account && body.password === account.password ? send(200, await grant(body.email)) : send(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' }); }
    if (url.pathname === '/auth/v1/user') return auth ? send(200, user(auth.email, auth.actor)) : send(401, { code: 'bad_jwt', msg: 'Invalid test session' });
    if (url.pathname === '/auth/v1/logout') return send(204, undefined);
    if (url.pathname === '/auth/v1/recover') return send(200, {});
    if (url.pathname === '/auth/v1/signup') return send(200, { user: { id: randomUUID(), email: body.email, identities: [] }, session: null });
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const functionName = url.pathname.split('/').at(-1);
      let result;
      if (functionName === 'studio_auth_bridge') result = await db.bridge(body.p_action, body.p_body);
      else {
        if (!auth) return send(401, { code: 'PT401', message: 'UNAUTHENTICATED' });
        if (functionName === 'studio_session') result = await db.session(auth.actor, body.p_action);
        else if (functionName === 'studio_read') result = await db.read(auth.actor, body.p_resource, body.p_id, body.p_query);
        else if (functionName === 'studio_catalog_search') result = await db.as(auth.actor, async c => (await c.query('select public.studio_catalog_search($1,$2,$3,$4) result', [body.p_resource, body.p_term, body.p_limit, body.p_offset])).rows[0].result);
        else if (functionName === 'studio_cancelled_history') result = await db.as(auth.actor, async c => (await c.query('select public.studio_cancelled_history($1,$2,$3) result', [body.p_limit, body.p_offset, body.p_session_id])).rows[0].result);
        else if (functionName === 'studio_command') result = await command(auth.actor, body.p_action, body.p_body, body.p_id, body.p_key, body.p_version, body.p_expected_actor ?? null);
        else return send(404, { code: 'not_found' });
      }
      return send(200, result);
    }
    return send(404, { code: 'test_route_not_found' });
  } catch (error) { const detail = error as { code?: string; message?: string }; return send(/^PT\d{3}$/.test(detail.code ?? '') ? Number(detail.code!.slice(2)) : 500, { code: detail.code ?? 'TEST_ERROR', message: detail.message ?? 'Test provider failed' }); }
});
await new Promise<void>(resolve => provider.listen(3211, '127.0.0.1', resolve));
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3210'], { cwd: process.cwd(), env: { ...process.env, APP_ENV: 'test', APP_ORIGIN: 'http://127.0.0.1:3210', SUPABASE_URL: 'http://127.0.0.1:3211', SUPABASE_PUBLISHABLE_KEY: 'test-publishable-placeholder', SUPABASE_SERVICE_ROLE_KEY: 'test-service-placeholder', RATE_LIMIT_SECRET: 'test-browser-only-rate-secret-1234567890' }, stdio: 'inherit', windowsHide: true });
let stopped = false;
async function shutdown() { if (stopped) return; stopped = true; child.kill(); provider.close(); await db.stop(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); child.on('exit', shutdown);
console.log('ISOLATED browser harness: controlled Auth HTTP + native PostgreSQL; NOT real GoTrue/SMTP.');

import EmbeddedPostgres from 'embedded-postgres';
import { Client, type QueryResultRow } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

export type Actor = { userId: string; sessionId: string; studentId: string };
export type Json = Record<string, unknown>;
export class TestPostgres {
  private engine!: EmbeddedPostgres;
  private port!: number;
  private password = randomBytes(24).toString('hex');
  private folder!: string;
  readonly backendPids = new Set<number>();
  async start() {
    const temp = process.platform === 'win32' ? join(tmpdir(), 'opencode') : tmpdir();
    await stat(tmpdir());
    await mkdir(temp, { recursive: true });
    await stat(temp); // Verify approved parent before creating a disposable cluster.
    const folder = await mkdtemp(join(temp, 'studio-postgres-test-')); this.folder=folder;
    const server = createServer();
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    this.port = (server.address() as { port: number }).port;
    await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r()));
    this.engine = new EmbeddedPostgres({ databaseDir: join(folder, 'data'), port: this.port,
      user: 'postgres', password: this.password, persistent: false, createPostgresUser: false,
      authMethod: 'scram-sha-256', autoRehydrateSymlinks: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=100', '-c', 'timezone=UTC'],
      onLog: () => {}, onError: () => {},
    });
    await this.engine.initialise(); await this.engine.start();
    await this.engine.createDatabase('studio_test');
    await this.dba(async c => {
      console.log(`Native database: ${(await c.query('select version() version')).rows[0].version}`);
      await c.query(await readFile(resolve('tests/helpers/auth-schema.sql'), 'utf8'));
      // Execute the ORIGINAL migrations, in tracked order. No simplified SQL replicas.
      for (const name of (await readdir(resolve('supabase/migrations'))).filter(n => n.endsWith('.sql')).sort()) {
        await c.query(await readFile(resolve('supabase/migrations', name), 'utf8'));
      }
    });
  }
  async stop() { try {if (this.engine) await this.engine.stop();} finally {if(this.folder) await rm(this.folder,{recursive:true,force:true});} }
  async connect() {
    const client = new Client({ host: '127.0.0.1', port: this.port, user: 'postgres', password: this.password, database: 'studio_test' });
    await client.connect();
    const pid = await client.query('select pg_backend_pid() pid'); this.backendPids.add(pid.rows[0].pid);
    await client.query("set statement_timeout='15s'; set lock_timeout='10s'");
    return client;
  }
  async dba<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.connect(); try { return await fn(client); } finally { await client.end(); }
  }
  async as<T>(actor: Actor | null, fn: (client: Client) => Promise<T>, role: 'authenticated' | 'anon' | 'service_role' = 'authenticated'): Promise<T> {
    return this.dba(async client => {
      await client.query('begin isolation level read committed');
      try {
        // Role is a hardcoded union in this TEST helper, never client input.
        await client.query(`set local role ${role}`);
        await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(actor ? { sub: actor.userId, session_id: actor.sessionId, role, exp: Math.floor(Date.now()/1000)+900 } : { role })]);
        const result = await fn(client); await client.query('commit'); return result;
      } catch (error) { await client.query('rollback'); throw error; }
    });
  }
  async actor(role: 'student' | 'admin' = 'student', metadata: Json = {}) {
    const actor: Actor = { userId: randomUUID(), sessionId: randomUUID(), studentId: '' };
    await this.dba(async c => {
      await c.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)', [actor.userId, `test-${actor.userId}@example.invalid`, JSON.stringify(metadata)]);
      await c.query('insert into auth.sessions(id,user_id) values($1,$2)', [actor.sessionId, actor.userId]);
      if (role === 'admin') await c.query("update app_private.user_roles set role='admin' where user_id=$1", [actor.userId]);
    });
    const result = await this.session(actor, 'register'); actor.studentId = result.studentId as string;
    return actor;
  }
  // Synthetic SQL callers bind their fixture actor by default. HTTP harnesses MUST pass
  // the transmitted p_expected_actor explicitly (?? null), never infer it from cookies.
  async command(actor: Actor, action: string, body: unknown = {}, id: string | null = null, key: string | null = null, version: number | null = null, expectedActor: string | null = actor.userId): Promise<Json> {
    return this.as(actor, async c => (await c.query('select public.studio_command($1,$2,$3::jsonb,$4,$5,$6) result', [action,id,JSON.stringify(body),key,version,expectedActor])).rows[0].result);
  }
  async read(actor: Actor, resource: string, id: string | null = null, query: unknown = {}): Promise<Json> {
    return this.as(actor, async c => (await c.query('select public.studio_read($1,$2,$3::jsonb) result', [resource,id,JSON.stringify(query)])).rows[0].result);
  }
  async session(actor: Actor, action: string): Promise<Json> {
    return this.as(actor, async c => (await c.query('select public.studio_session($1) result',[action])).rows[0].result);
  }
  async bridge(action: string, body: unknown, requestActor?: Actor): Promise<Json> {
    const input = action==='link_invitation' && requestActor ? {...body as Json,expectedActor:requestActor.userId,requestSessionId:requestActor.sessionId} : body;
    return this.as(null, async c => (await c.query('select public.studio_auth_bridge($1,$2::jsonb) result',[action,JSON.stringify(input)])).rows[0].result,'service_role');
  }
  async rows<T extends QueryResultRow>(sql: string, args: unknown[] = []): Promise<T[]> { return this.dba(async c => (await c.query<T>(sql,args)).rows); }
  async holdSession(id: string) {
    const client = await this.connect(); await client.query('begin');
    await client.query('select 1 from app_private.class_sessions where id=$1 for update',[id]);
    return async () => { await client.query('commit'); await client.end(); };
  }
  async waitForLocks(count: number) {
    for (let i=0;i<100;i++) {
      const rows=await this.rows<{ n: string }>("select count(*) n from pg_stat_activity where datname='studio_test' and wait_event_type='Lock'");
      if (Number(rows[0].n)>=count) return;
      await new Promise(r=>setTimeout(r,20));
    }
    throw new Error(`Did not observe ${count} concurrent lock waiters`);
  }
}

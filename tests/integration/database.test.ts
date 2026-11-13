import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TestPostgres, type Actor, type Json } from '../helpers/postgres';
import { rpc } from '@/lib/server/rpc';
import type { SupabaseClient } from '@supabase/supabase-js';

const db = new TestPostgres(); let admin: Actor; let teacher: string;
// Explicitly SYNTHETIC TEST policy, NOT an approved commercial configuration.
const testPolicies = { bookingWindow: { mode:'unrestricted' }, cancellation: { mode:'unrestricted' }, eligibility: { mode:'unrestricted' }, adminOnBehalf: { mode:'unrestricted' } };
const key = () => randomUUID();
const items = (v: Json) => v.items as Json[];
const resourceId = (v: Json) => (v.reference as { reservationId: string }).reservationId;
async function configure(policies: unknown) {
  const current=await db.read(admin,'admin.settings');
  return db.command(admin,'admin.settings.update',{policies},null,null,current.version as number);
}
async function createClass(capacity=1,bikeMode='none',status='published',bikeIds?: string[],startsAt='2035-10-31T12:00:00Z') {
  const bikes=bikeIds ?? await Promise.all(Array.from({length:capacity},async()=> (await db.command(admin,'admin.bikes.create',{label:`B-${key()}`.slice(0,40)})).id as string));
  const endsAt=new Date(Date.parse(startsAt)+3600000).toISOString();
  return db.command(admin,'admin.sessions.create',{title:'TEST fixture',instructorId:teacher,startsAt,endsAt,timezone:'America/Sao_Paulo',capacity,bikeMode,bikeIds:bikes,status});
}
async function reserve(actor:Actor,session:Json,bikeId?:string,opKey=key()) { return db.command(actor,'reserve',{sessionId:session.id,...(bikeId?{bikeId}:{})},null,opKey); }
async function confirmed(id:unknown) { return Number((await db.rows<{n:string}>("select count(*) n from app_private.reservations where session_id=$1 and status='confirmed'",[id]))[0].n); }

beforeAll(async()=> {
  await db.start(); admin=await db.actor('admin');
  teacher=(await db.command(admin,'admin.instructors.create',{name:'TEST instructor'})).id as string;
});
afterAll(async()=> { console.log(`Native PostgreSQL independent backend processes observed: ${db.backendPids.size}`); await db.stop(); });

test('catalog search filters before pagination, includes archives, treats wildcards literally and enforces admin scope',async()=> {
  const search = (actor:Actor,resource:string,term:string,limit=20,offset=0) => db.as(actor,async c =>
    (await c.query('select public.studio_catalog_search($1,$2,$3,$4) result',[resource,term,limit,offset])).rows[0].result as Json);
  const suffix=key().slice(0,8);
  const students=await Promise.all(Array.from({length:23},(_,n)=>db.command(admin,'admin.students.create',{
    fullName:`TEST Find ${suffix} ${String(n).padStart(2,'0')}`, contactEmail:n===22?`lookup-${suffix}@example.invalid`:null,
  })));
  const archived=students[22]; await db.command(admin,'admin.students.archive',{},archived.id as string,null,archived.version as number);
  expect(items(await search(admin,'students',`find ${suffix}`,20,0))).toHaveLength(20);
  expect(items(await search(admin,'students',`find ${suffix}`,20,20))).toHaveLength(3);
  expect(items(await search(admin,'students',`lookup-${suffix}`))[0]).toMatchObject({id:archived.id,archivedAt:expect.any(String)});
  expect(items(await search(admin,'students','%'))).toHaveLength(0);
  const instructor=await db.command(admin,'admin.instructors.create',{name:`TEST Coach ${suffix}`});
  const bike=await db.command(admin,'admin.bikes.create',{label:`TEST Bike ${suffix}`});
  expect(items(await search(admin,'instructors',suffix))[0].id).toBe(instructor.id);
  expect(items(await search(admin,'bikes',suffix))[0].id).toBe(bike.id);
  const student=await db.actor();
  await expect(search(student,'students',suffix)).rejects.toMatchObject({code:'PT403'});
  await expect(db.as(null,c=>c.query("select public.studio_catalog_search('students','test')"),'anon')).rejects.toMatchObject({code:'42501'});
  await expect(search(admin,'students',' ',20)).rejects.toMatchObject({code:'PT422'});
  await expect(search(admin,'students',suffix,101)).rejects.toMatchObject({code:'PT422'});
  await expect(search(admin,'settings',suffix)).rejects.toMatchObject({code:'PT422'});
});

describe('original migrations / RBAC / Auth session guard',()=> {
  test('default unconfigured policies block publishing, not a hidden commercial rule',async()=> {
    await expect(createClass()).rejects.toMatchObject({code:'PT409',message:'POLICY_UNCONFIGURED'});
    await configure(testPolicies);
  });
  test('user_metadata cannot promote a public signup or link an arbitrary student',async()=> {
    const actor=await db.actor('student',{role:'admin',is_admin:true,student_id:admin.studentId});
    expect((await db.session(actor,'check')).role).toBe('student');
    expect(actor.studentId).not.toBe(admin.studentId);
    await expect(db.read(actor,'admin.students')).rejects.toMatchObject({code:'PT403'});
    await expect(db.command(actor,'me.update',{role:'admin'},null,null,1)).rejects.toMatchObject({code:'PT422'});
  });
  test('private schemas, direct table writes, service bridge and anonymous RPC are denied',async()=> {
    const actor=await db.actor();
    await expect(db.as(actor,c=>c.query('select * from app_private.students'))).rejects.toMatchObject({code:'42501'});
    await expect(db.as(actor,c=>c.query("insert into app_private.user_roles(user_id,role) values($1,'admin')",[actor.userId]))).rejects.toMatchObject({code:'42501'});
    await expect(db.as(actor,c=>c.query("select public.studio_auth_bridge('revoke_user','{}')"))).rejects.toMatchObject({code:'42501'});
    await expect(db.as(null,c=>c.query("select public.studio_session('register')"),'anon')).rejects.toMatchObject({code:'42501'});
    await expect(db.as(null,c=>c.query("select public.studio_read('sessions')"),'service_role')).rejects.toMatchObject({code:'42501'});
    const flags=await db.rows<{rolsuper:boolean;rolbypassrls:boolean;rolcanlogin:boolean}>("select rolsuper,rolbypassrls,rolcanlogin from pg_roles where rolname='studio_owner'");
    expect(flags[0]).toEqual({rolsuper:false,rolbypassrls:false,rolcanlogin:false});
    const rls=await db.rows<{relrowsecurity:boolean}>("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relkind='r'");
    expect(rls.length).toBeGreaterThan(10); expect(rls.every(x=>x.relrowsecurity)).toBe(true);
    const paths=await db.rows<{proconfig:string[]}>("select proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prosecdef");
    expect(paths.every(x=>x.proconfig.some(p=>p==='search_path=""'))).toBe(true);
  });
  test('logout denies direct RPC and re-registration with the same previously issued JWT/session',async()=> {
    const actor=await db.actor(); await db.session(actor,'revoke');
    await expect(db.read(actor,'sessions')).rejects.toMatchObject({code:'PT401'});
    await expect(db.session(actor,'register')).rejects.toMatchObject({code:'PT401'});
    await db.session(actor,'revoke'); // idempotent
  });
  test('expired/deleted Auth session, missing session claim and archived account are denied',async()=> {
    const expired=await db.actor();
    await db.rows('update auth.sessions set not_after=now()-interval \'1 second\' where id=$1',[expired.sessionId]);
    await expect(db.session(expired,'check')).rejects.toMatchObject({code:'PT401'});
    const jwtExpired=await db.actor();
    await expect(db.as(jwtExpired,async c=> {
      await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:jwtExpired.userId,session_id:jwtExpired.sessionId,exp:1})]);
      return c.query("select public.studio_read('me')");
    })).rejects.toMatchObject({code:'PT401'});
    const removed=await db.actor(); await db.rows('delete from auth.sessions where id=$1',[removed.sessionId]);
    await expect(db.session(removed,'check')).rejects.toMatchObject({code:'PT401'});
    const archived=await db.actor(); const current=await db.read(admin,'admin.students',archived.studentId);
    await db.command(admin,'admin.students.archive',{},archived.studentId,null,current.version as number);
    await expect(db.session(archived,'register')).rejects.toMatchObject({code:'PT403'});
    await expect(db.as(null,c=>c.query("select public.studio_read('sessions')"))).rejects.toMatchObject({code:'PT401'});
  });
  test('archive/restore revokes unregistered pre-archive sessions at DB precision, without permanently blocking new logins',async()=> {
    const actor=await db.actor(); const oldSession=randomUUID();
    // Start archive first but hold its student lock: Auth issues a session AFTER transaction
    // start and BEFORE the actual archive. Using now() for the barrier would miss it.
    const blocker=await db.connect(); await blocker.query('begin');
    await blocker.query('select 1 from app_private.students where id=$1 for update',[actor.studentId]);
    const archiving=db.command(admin,'admin.students.archive',{},actor.studentId,null,1);
    try {
      await db.waitForLocks(1);
      await db.rows('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',[oldSession,actor.userId]);
    } finally {await blocker.query('commit');await blocker.end();}
    const archived=await archiving;
    const [{barrier,oldGuardAbsent,oldSessionRevoked}]=await db.rows<{barrier:string;oldGuardAbsent:boolean;oldSessionRevoked:boolean}>(
      `select p.auth_revoked_before::text barrier,
        not exists(select 1 from app_private.session_guards where session_id=$2) as "oldGuardAbsent",
        p.auth_revoked_before >= a.created_at as "oldSessionRevoked"
       from app_private.profiles p join auth.sessions a on a.id=$2 where p.id=$1`,[actor.userId,oldSession]);
    expect(barrier).not.toBeNull();expect(oldGuardAbsent).toBe(true);expect(oldSessionRevoked).toBe(true);
    await db.command(admin,'admin.students.update',{restore:true},actor.studentId,null,archived.version as number);
    expect((await db.rows<{barrier:string}>('select auth_revoked_before::text barrier from app_private.profiles where id=$1',[actor.userId]))[0].barrier).toBe(barrier);
    await expect(db.session({...actor,sessionId:oldSession},'register')).rejects.toMatchObject({code:'PT401'});
    await expect(db.session(actor,'register')).rejects.toMatchObject({code:'PT401'});
    // Boundary comparisons remain in PostgreSQL: Date/JSON millisecond rounding must not
    // mask equality or a valid timestamp one microsecond after the fixed archive barrier.
    const equalSession=randomUUID();const afterSession=randomUUID();const freshSession=randomUUID();
    await db.rows(`insert into auth.sessions(id,user_id,created_at)
      select $1,id,auth_revoked_before from app_private.profiles where id=$2`,[equalSession,actor.userId]);
    await expect(db.session({...actor,sessionId:equalSession},'register')).rejects.toMatchObject({code:'PT401'});
    await db.rows(`insert into auth.sessions(id,user_id,created_at)
      select $1,id,auth_revoked_before+interval '1 microsecond' from app_private.profiles where id=$2`,[afterSession,actor.userId]);
    expect((await db.session({...actor,sessionId:afterSession},'register')).studentId).toBe(actor.studentId);
    await db.rows('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())',[freshSession,actor.userId]);
    expect((await db.session({...actor,sessionId:freshSession},'register')).studentId).toBe(actor.studentId);
    expect((await db.read({...actor,sessionId:freshSession},'me')).id).toBe(actor.userId);
  });
  test('a matching email alone cannot bind a pre-registration; exact invitation identity plus confirmation can',async()=> {
    const account=await db.actor();
    const email=`test-${account.userId}@example.invalid`;
    const pre=await db.command(admin,'admin.students.create',{fullName:'TEST prereg',contactEmail:email});
    expect((await db.read(admin,'admin.students',pre.id as string)).userId).toBeNull();
    const inviteId=randomUUID(); const inviteSession=randomUUID();
    await db.rows('insert into auth.users(id,email) values($1,$2)',[inviteId,`invite-${key()}@example.invalid`]);
    await db.rows('insert into auth.sessions(id,user_id) values($1,$2)',[inviteSession,inviteId]);
    await db.bridge('link_invitation',{userId:inviteId,studentId:pre.id,version:pre.version},admin);
    const invited:Actor={userId:inviteId,sessionId:inviteSession,studentId:pre.id as string};
    await expect(db.session(invited,'register')).rejects.toMatchObject({code:'PT403',message:'INVITATION_UNCONFIRMED'});
    await db.rows('update auth.users set email_confirmed_at=now() where id=$1',[inviteId]);
    expect((await db.session(invited,'register')).studentId).toBe(pre.id);
    expect((await db.read(invited,'me')).fullName).toBe('TEST prereg');
  });
  test('parallel first logins share one student identity; existing account cannot be relinked by an invite',async()=> {
    const userId=randomUUID();await db.rows('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[userId,`parallel-${key()}@example.invalid`]);
    const actors=Array.from({length:4},()=>({userId,sessionId:randomUUID(),studentId:''}));
    for(const actor of actors) await db.rows('insert into auth.sessions(id,user_id) values($1,$2)',[actor.sessionId,userId]);
    const sessions=await Promise.all(actors.map(a=>db.session(a,'register')));
    expect(new Set(sessions.map(s=>s.studentId)).size).toBe(1);
    const prereg=await db.command(admin,'admin.students.create',{fullName:'TEST no relink'});
    await expect(db.bridge('link_invitation',{userId,studentId:prereg.id,version:1},admin)).rejects.toMatchObject({code:'PT409',message:'INVITATION_CONFLICT'});
  });
  test('archiving an invitation blocks its Auth identity before activation and even with a recovery guard',async()=> {
    const userId=randomUUID();const sessionId=randomUUID();
    await db.rows('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[userId,`archive-invite-${key()}@example.invalid`]);
    await db.rows('insert into auth.sessions(id,user_id) values($1,$2)',[sessionId,userId]);
    const pre=await db.command(admin,'admin.students.create',{fullName:'TEST invitation archive'});
    await db.bridge('link_invitation',{userId,studentId:pre.id,version:1},admin);
    await db.bridge('recovery_grant',{userId,sessionId});
    await db.command(admin,'admin.students.archive',{},pre.id as string,null,2);
    const actor={userId,sessionId,studentId:pre.id as string};
    await expect(db.read(actor,'me')).rejects.toMatchObject({code:'PT401'});
    await expect(db.session(actor,'register')).rejects.toMatchObject({code:'PT403'});
  });
  test('ordinary sessions have no recovery grant; grants expire, are consumed once and cannot be extended by replay',async()=> {
    const actor=await db.actor(); const input={userId:actor.userId,sessionId:actor.sessionId};
    await expect(db.bridge('consume_recovery',input)).rejects.toMatchObject({code:'PT401'});
    await db.bridge('recovery_grant',input); await db.bridge('consume_recovery',input);
    await db.bridge('recovery_grant',input);
    await expect(db.bridge('consume_recovery',input)).rejects.toMatchObject({code:'PT401'});
    const expired=await db.actor(); const second={userId:expired.userId,sessionId:expired.sessionId};
    await db.bridge('recovery_grant',second);
    await db.rows("update app_private.recovery_grants set expires_at=now()-interval '1 second' where session_id=$1",[expired.sessionId]);
    await expect(db.bridge('consume_recovery',second)).rejects.toMatchObject({code:'PT401'});
    await db.bridge('revoke_user',input); await expect(db.read(actor,'me')).rejects.toMatchObject({code:'PT401'});
    const unregistered=randomUUID(); await db.rows('insert into auth.sessions(id,user_id,created_at) values($1,$2,now()-interval \'1 hour\')',[unregistered,actor.userId]);
    await expect(db.session({...actor,sessionId:unregistered},'register')).rejects.toMatchObject({code:'PT401'});
  });
  test('server profile allowlist and versions work in the original SQL, not only Zod',async()=> {
    const actor=await db.actor();
    await expect(db.command(actor,'me.update',{fullName:{nested:'bad'}},null,null,1)).rejects.toMatchObject({code:'PT422'});
    const updated=await db.command(actor,'me.update',{fullName:'TEST updated',phone:'123'},null,null,1);
    expect(updated).toMatchObject({id:actor.userId,fullName:'TEST updated',phone:'123',version:2,role:'student'});
    const adminView=await db.read(admin,'admin.students',actor.studentId);expect(adminView).toMatchObject({fullName:'TEST updated',phone:'123',version:2});
    await expect(db.command(actor,'me.update',{fullName:'stale'},null,null,1)).rejects.toMatchObject({code:'PT409'});
    await expect(db.command(actor,'me.update',{active:true},null,null,2)).rejects.toMatchObject({code:'PT422'});
  });
  test('persistent security limiter increments atomically across separate connections',async()=> {
    const bucket=`TEST-${key()}`;
    const results=await Promise.all(Array.from({length:6},()=>db.bridge('rate_limit',{bucket,limit:3,seconds:60})));
    expect(results.filter(x=>x.allowed)).toHaveLength(3);
    const stored=await db.rows<{hits:number}>('select hits from app_private.rate_limits where bucket=$1',[bucket]);expect(stored[0].hits).toBe(6);
  });
});

describe('AUD-M01 expected-actor binding in original SQL transactions',()=> {
  test('direct RPC rejects missing/mismatched actors before consuming an intention key, reservation or audit',async()=> {
    const a=await db.actor();const b=await db.actor();const session=await createClass(2);const opKey=key();
    const before=await db.rows<{n:string}>('select count(*) n from app_private.audit_events where actor_id=$1',[b.userId]);
    // Deliberately omit the final argument: the SQL default is NULL, not a bypass/legacy overload.
    await expect(db.as(b,c=>c.query('select public.studio_command($1,$2,$3::jsonb,$4,$5)',
      ['reserve',null,JSON.stringify({sessionId:session.id}),opKey,null]))).rejects.toMatchObject({code:'PT422',message:'EXPECTED_ACTOR_REQUIRED'});
    await expect(db.command(b,'reserve',{sessionId:session.id},null,opKey,null,a.userId)).rejects.toMatchObject({code:'PT409',message:'ACTOR_CHANGED'});
    expect(await confirmed(session.id)).toBe(0);
    expect(await db.read(b,'operations',null,{key:opKey})).toEqual({state:'not_observed'});
    expect(await db.rows('select key from app_private.idempotency_operations where actor_id=$1 and key=$2',[b.userId,opKey])).toHaveLength(0);
    expect((await db.rows<{n:string}>('select count(*) n from app_private.audit_events where actor_id=$1',[b.userId]))[0].n).toBe(before[0].n);
    // The original actor can still apply/replay its unchanged key; B cannot execute A's retry.
    const applied=await db.command(a,'reserve',{sessionId:session.id},null,opKey,null,a.userId);
    expect(applied.outcome).toBe('applied');expect((applied.resource as Json).studentId).toBe(a.studentId);
    expect((await db.command(a,'reserve',{sessionId:session.id},null,opKey,null,a.userId)).replayed).toBe(true);
    await expect(db.command(b,'reserve',{sessionId:session.id},null,opKey,null,a.userId)).rejects.toMatchObject({code:'PT409',message:'ACTOR_CHANGED'});
    expect(await confirmed(session.id)).toBe(1);
    expect(items(await db.read(b,'reservations'))).toHaveLength(0);
  });
  test('profile/admin forms fail before domain writes and matching bindings do not grant admin permission',async()=> {
    const a=await db.actor('admin');const b=await db.actor('admin');const student=await db.actor();
    const profile=await db.read(b,'me');const label=`B-${key()}`.slice(0,40);const name=`TEST binding ${key()}`;
    const cases:[string,Json,string|null,number|null][]=[
      ['me.update',{fullName:name},null,profile.version as number],
      ['admin.students.create',{fullName:name},null,null],
      ['admin.instructors.create',{name},null,null],
      ['admin.bikes.create',{label},null,null],
      ['admin.settings.update',{policies:testPolicies},null,1],
      ['admin.sessions.archive',{},randomUUID(),1],
    ];
    for(const [action,input,id,version] of cases) {
      await expect(db.command(b,action,input,id,null,version,a.userId)).rejects.toMatchObject({code:'PT409',message:'ACTOR_CHANGED'});
      await expect(db.command(b,action,input,id,null,version,null)).rejects.toMatchObject({code:'PT422',message:'EXPECTED_ACTOR_REQUIRED'});
    }
    expect(await db.read(b,'me')).toEqual(profile);
    expect(await db.rows('select id from app_private.students where full_name=$1',[name])).toHaveLength(0);
    expect(await db.rows('select id from app_private.instructors where name=$1',[name])).toHaveLength(0);
    expect(await db.rows('select id from app_private.bikes where label=$1',[label])).toHaveLength(0);
    expect((await db.command(b,'me.update',{fullName:name},null,null,profile.version as number,b.userId)).fullName).toBe(name);
    await expect(db.command(student,'admin.bikes.create',{label},null,null,null,student.userId)).rejects.toMatchObject({code:'PT403',message:'FORBIDDEN'});
  });
  test('new RPC signature has no old executable overload and still denies anonymous/service/private-helper access',async()=> {
    const actor=await db.actor();
    const [signature]=await db.rows<{oldAbsent:boolean;newPresent:boolean}>(`select
      to_regprocedure('public.studio_command(text,uuid,jsonb,text,bigint)') is null as "oldAbsent",
      to_regprocedure('public.studio_command(text,uuid,jsonb,text,bigint,uuid)') is not null as "newPresent"`);
    expect(signature).toEqual({oldAbsent:true,newPresent:true});
    for(const role of ['anon','service_role'] as const) {
      await expect(db.as(null,c=>c.query("select public.studio_command('me.update',null,'{}',null,1,$1)",[actor.userId]),role)).rejects.toMatchObject({code:'42501'});
    }
    await expect(db.as(actor,c=>c.query('select app_private.require_expected_actor($1,$1)',[actor.userId]))).rejects.toMatchObject({code:'42501'});
  });
  test('invitation bridge binds its verified request session, expected actor and admin role before linkage',async()=> {
    const other=await db.actor('admin');const student=await db.actor();const inviteeId=randomUUID();
    await db.rows('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[inviteeId,`binding-${key()}@example.invalid`]);
    const pre=await db.command(admin,'admin.students.create',{fullName:'TEST bound invitation'});
    const input={userId:inviteeId,studentId:pre.id,version:1};
    await expect(db.bridge('link_invitation',{...input,requestSessionId:other.sessionId})).rejects.toMatchObject({code:'PT422',message:'EXPECTED_ACTOR_REQUIRED'});
    await expect(db.bridge('link_invitation',{...input,expectedActor:admin.userId,requestSessionId:other.sessionId})).rejects.toMatchObject({code:'PT409',message:'ACTOR_CHANGED'});
    await expect(db.bridge('link_invitation',{...input,expectedActor:student.userId,requestSessionId:student.sessionId})).rejects.toMatchObject({code:'PT403',message:'FORBIDDEN'});
    await db.session(other,'revoke');
    await expect(db.bridge('link_invitation',{...input,expectedActor:other.userId,requestSessionId:other.sessionId})).rejects.toMatchObject({code:'PT401'});
    expect((await db.read(admin,'admin.students',pre.id as string))).toMatchObject({version:1,invited:false,userId:null});
    expect(await db.rows("select id from app_private.audit_events where action='student.invited' and resource_id=$1",[pre.id])).toHaveLength(0);
    await db.bridge('link_invitation',input,admin);
    expect((await db.read(admin,'admin.students',pre.id as string))).toMatchObject({version:2,invited:true});
    expect((await db.rows<{actor_id:string}>("select actor_id from app_private.audit_events where action='student.invited' and resource_id=$1",[pre.id]))[0].actor_id).toBe(admin.userId);
  });
});

describe('real multi-connection reservation transactions',()=> {
  test('8 simultaneous attempts for the LAST place: exactly 1 commit, 7 persisted rejections',async()=> {
    const session=await createClass(); const actors=await Promise.all(Array.from({length:8},()=>db.actor()));
    const unlock=await db.holdSession(session.id as string);
    const attempts=Promise.all(actors.map(actor=>reserve(actor,session)));
    await db.waitForLocks(8); await unlock(); const results=await attempts;
    expect(results.filter(r=>r.outcome==='applied')).toHaveLength(1);
    expect(results.filter(r=>(r.error as Json)?.code==='SESSION_FULL')).toHaveLength(7);
    expect(await confirmed(session.id)).toBe(1);
    const stored=await db.rows<{n:string}>("select count(*) n from app_private.idempotency_operations where request->'body'->>'sessionId'=$1 and outcome='rejected'",[session.id]);
    expect(Number(stored[0].n)).toBe(7);
  });
  test('same student, 6 separate keys: partial unique + student lock prevent duplicates',async()=> {
    const session=await createClass(6); const actor=await db.actor();
    const unlock=await db.holdSession(session.id as string); const pending=Promise.all(Array.from({length:6},()=>reserve(actor,session)));
    await db.waitForLocks(6); await unlock(); const results=await pending;
    expect(results.filter(r=>r.outcome==='applied')).toHaveLength(1); expect(await confirmed(session.id)).toBe(1);
    expect(results.filter(r=>(r.error as Json)?.code==='ALREADY_RESERVED')).toHaveLength(5);
  });
  test('same bike, different students, capacity 4: exactly one bike reservation',async()=> {
    const session=await createClass(4,'required'); const bikes=items(await db.read(admin,'session_bikes',session.id as string));
    const actors=await Promise.all(Array.from({length:4},()=>db.actor())); const unlock=await db.holdSession(session.id as string);
    const pending=Promise.all(actors.map(a=>reserve(a,session,bikes[0].id as string))); await db.waitForLocks(4); await unlock();
    const results=await pending; expect(results.filter(r=>r.outcome==='applied')).toHaveLength(1);
    expect(results.filter(r=>(r.error as Json)?.code==='BIKE_TAKEN')).toHaveLength(3); expect(await confirmed(session.id)).toBe(1);
  });
  test('same idempotency key under concurrency commits once and returns the same original reference',async()=> {
    const session=await createClass(3); const actor=await db.actor(); const opKey=key();
    const unlock=await db.holdSession(session.id as string); const pending=Promise.all(Array.from({length:5},()=>reserve(actor,session,undefined,opKey)));
    await db.waitForLocks(5); await unlock(); const results=await pending;
    expect(new Set(results.map(resourceId)).size).toBe(1); expect(results.filter(r=>!r.replayed)).toHaveLength(1); expect(await confirmed(session.id)).toBe(1);
    await expect(db.command(actor,'reserve',{sessionId:session.id,bikeId:randomUUID()},null,opKey)).rejects.toMatchObject({code:'PT409',message:'IDEMPOTENCY_CONFLICT'});
  });
  test('replay after cancellation never recreates a reservation; observation is actor-isolated',async()=> {
    const actor=await db.actor(); const other=await db.actor(); const session=await createClass(); const opKey=key();
    expect(await db.read(actor,'operations',null,{key:opKey})).toEqual({state:'not_observed'});
    const created=await reserve(actor,session,undefined,opKey); const rid=resourceId(created);
    await db.command(actor,'cancel',{},rid,key());
    const replay=await reserve(actor,session,undefined,opKey);
    expect((replay.resource as Json).status).toBe('confirmed'); expect((replay.currentResource as Json).status).toBe('cancelled'); expect(await confirmed(session.id)).toBe(0);
    const observed=await db.read(actor,'operations',null,{key:opKey}); expect(observed.state).toBe('observed'); expect((observed.currentResource as Json).status).toBe('cancelled');
    expect(await db.read(other,'operations',null,{key:opKey})).toEqual({state:'not_observed'});
    await expect(db.read(other,'reservations',rid)).rejects.toMatchObject({code:'PT404'});
    expect((await db.command(other,'cancel',{},rid,key())).error).toEqual({code:'NOT_FOUND'});
    expect(items(await db.read(other,'reservations'))).toHaveLength(0);
  });
  test('a persisted rejection remains rejected on replay even after a place becomes free',async()=> {
    const session=await createClass(); const a=await db.actor(); const b=await db.actor(); const first=await reserve(a,session); const opKey=key();
    expect((await reserve(b,session,undefined,opKey)).outcome).toBe('rejected');
    await db.command(a,'cancel',{},resourceId(first),key());
    expect((await reserve(b,session,undefined,opKey)).outcome).toBe('rejected');
    expect((await reserve(b,session)).outcome).toBe('applied');
  });
  test('cancel and capacity reduction serialize on the SAME session row',async()=> {
    const session=await createClass(2); const a=await db.actor(); const b=await db.actor();
    await reserve(a,session); const second=await reserve(b,session);
    const unlock=await db.holdSession(session.id as string);
    const edit=db.command(admin,'admin.sessions.update',{capacity:1},session.id as string,null,session.version as number).catch(e=>({code:e.code,message:e.message}));
    const cancel=db.command(b,'cancel',{},resourceId(second),key());
    await db.waitForLocks(2); await unlock(); const [changed,cancelled]=await Promise.all([edit,cancel]);
    expect(cancelled.outcome).toBe('applied');
    const current=await db.read(admin,'sessions',session.id as string); expect(current.capacity as number).toBeGreaterThanOrEqual(await confirmed(session.id));
    if ('code' in changed) expect(changed.message).toBe('CAPACITY_BELOW_RESERVATIONS'); else expect(changed.capacity).toBe(1);
  });
  test('class cancellation and reserve cannot leave confirmed reservations on a cancelled class',async()=> {
    const session=await createClass(2); const actor=await db.actor(); const unlock=await db.holdSession(session.id as string);
    const first=reserve(actor,session); const cancellation=db.command(admin,'admin.sessions.archive',{},session.id as string,null,session.version as number);
    await db.waitForLocks(2); await unlock(); await Promise.all([first,cancellation]);
    expect(await confirmed(session.id)).toBe(0); expect((await db.read(actor,'sessions',session.id as string)).sessionStatus).toBe('cancelled');
  });
  test('class cancellation changes all affected reservations and records their IDs atomically',async()=> {
    const session=await createClass(2); const a=await db.actor(); const b=await db.actor();
    const first=await reserve(a,session); const second=await reserve(b,session);
    await db.command(admin,'admin.sessions.archive',{},session.id as string,null,1);
    expect(await confirmed(session.id)).toBe(0);
    const audit=await db.rows<{details:{reservationIds:string[]}}>("select details from app_private.audit_events where action='session.cancel_reservations' and resource_id=$1",[session.id]);
    expect(audit[0].details.reservationIds.sort()).toEqual([resourceId(first),resourceId(second)].sort());
  });
  test('technical failure in audit rolls back reservation AND idempotency; same key can be retried',async()=> {
    const session=await createClass(); const actor=await db.actor(); const opKey=key();
    await db.rows(`create function public.test_fail_audit() returns trigger language plpgsql as $$ begin
      if new.action='reservation.create' then raise exception 'TEST technical failure'; end if; return new; end $$;
      create trigger test_audit_failure before insert on app_private.audit_events for each row execute function public.test_fail_audit()`);
    try { await expect(reserve(actor,session,undefined,opKey)).rejects.toThrow('TEST technical failure'); }
    finally { await db.rows('drop trigger test_audit_failure on app_private.audit_events; drop function public.test_fail_audit()'); }
    expect(await confirmed(session.id)).toBe(0); expect(await db.read(actor,'operations',null,{key:opKey})).toEqual({state:'not_observed'});
    expect((await reserve(actor,session,undefined,opKey)).outcome).toBe('applied');
  });
  test('real PostgreSQL serialization fault aborts the whole RPC; actual retry adapter reuses its key and commits once',async()=> {
    const session=await createClass(); const actor=await db.actor(); const opKey=key(); let attempts=0;
    // A sequence survives rollback, so inject exactly ONE real 40001 in the original audit path.
    await db.rows(`create sequence public.test_serialization_seq;
      grant usage on sequence public.test_serialization_seq to studio_owner;
      create function public.test_serialization_fault() returns trigger language plpgsql as $$ begin
      if new.action='reservation.create' and nextval('public.test_serialization_seq')=1 then
        raise exception using errcode='40001',message='TEST serialization fault'; end if; return new; end $$;
      create trigger test_serialization_failure before insert on app_private.audit_events for each row execute function public.test_serialization_fault()`);
    const adapter={rpc:async(_name:string,args:Record<string,unknown>)=> {
      attempts++;
      try { return {data:await db.command(actor,args.p_action as string,args.p_body,null,args.p_key as string,null,args.p_expected_actor as string),error:null}; }
      catch(error) {const e=error as {code:string;message:string}; return {data:null,error:{code:e.code,message:e.message}};}
    }};
    let result:Json;
    try {result=await rpc<Json>(adapter as unknown as SupabaseClient,'studio_command',{p_action:'reserve',p_body:{sessionId:session.id},p_key:opKey,p_expected_actor:actor.userId},true);}
    finally {await db.rows('drop trigger test_serialization_failure on app_private.audit_events; drop function public.test_serialization_fault(); drop sequence public.test_serialization_seq');}
    expect(attempts).toBe(2); expect(result!.outcome).toBe('applied'); expect(await confirmed(session.id)).toBe(1);
    const persisted=await db.rows<{n:string}>('select count(*) n from app_private.idempotency_operations where actor_id=$1 and key=$2',[actor.userId,opKey]); expect(Number(persisted[0].n)).toBe(1);
  });
  test('five concurrent cancellations perform one state transition and one cancellation audit',async()=> {
    const session=await createClass(); const actor=await db.actor(); const created=await reserve(actor,session); const rid=resourceId(created);
    const unlock=await db.holdSession(session.id as string);
    const pending=Promise.all(Array.from({length:5},()=>db.command(actor,'cancel',{},rid,key())));
    await db.waitForLocks(5); await unlock(); const results=await pending;
    expect(results.every(x=>x.outcome==='applied')).toBe(true); expect(await confirmed(session.id)).toBe(0);
    expect((await db.read(actor,'reservations',rid)).version).toBe(2);
    const audits=await db.rows<{n:string}>("select count(*) n from app_private.audit_events where resource_id=$1 and action='reservation.cancel'",[rid]); expect(Number(audits[0].n)).toBe(1);
  });
  test('unsupported snapshot isolation fails closed instead of using a stale capacity count',async()=> {
    const session=await createClass(); const actor=await db.actor();
    await expect(db.dba(async c=> {
      await c.query('begin isolation level repeatable read');
      try {
        await c.query('set local role authenticated');
        await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor.userId,session_id:actor.sessionId,exp:Math.floor(Date.now()/1000)+900})]);
        await c.query("select public.studio_command('reserve',null,$1::jsonb,$2,null,$3)",[JSON.stringify({sessionId:session.id}),key(),actor.userId]);
      } finally {await c.query('rollback');}
    })).rejects.toMatchObject({code:'PT503',message:'ISOLATION_LEVEL_UNSUPPORTED'});
    expect(await confirmed(session.id)).toBe(0);
  });
});

describe('admin business invariants / optimistic concurrency',()=> {
  test('admin cancels an archived student reservation idempotently without restoring access or allowing new bookings',async()=> {
    await configure(testPolicies); // SYNTHETIC TEST policies: explicit on-behalf permission.
    const actor=await db.actor();const session=await createClass();const created=await reserve(actor,session);const rid=resourceId(created);
    await db.command(admin,'admin.students.archive',{},actor.studentId,null,1);
    expect(await confirmed(session.id)).toBe(1);
    expect((await db.command(admin,'admin.reserve',{studentId:actor.studentId,sessionId:session.id},null,key())).error).toEqual({code:'STUDENT_INACTIVE'});
    await expect(reserve(actor,session)).rejects.toMatchObject({code:'PT401'});
    await expect(db.command(actor,'cancel',{},rid,key())).rejects.toMatchObject({code:'PT401'});
    const opKey=key();const results=await Promise.all(Array.from({length:2},()=>db.command(admin,'admin.cancel',{},rid,opKey)));
    expect(results.every(r=>r.outcome==='applied' && resourceId(r)===rid)).toBe(true);
    expect(results.filter(r=>r.replayed)).toHaveLength(1);
    expect((await db.read(admin,'admin.reservations',rid))).toMatchObject({status:'cancelled',version:2});
    expect(await confirmed(session.id)).toBe(0);
    expect((await db.read(admin,'admin.students',actor.studentId)).archivedAt).not.toBeNull();
    expect((await db.rows<{active:boolean}>('select active from app_private.profiles where id=$1',[actor.userId]))[0].active).toBe(false);
    await expect(db.read(actor,'me')).rejects.toMatchObject({code:'PT401'});
    await expect(db.session(actor,'register')).rejects.toMatchObject({code:'PT403'});
    const audits=await db.rows<{n:string}>("select count(*) n from app_private.audit_events where action='reservation.cancel' and resource_id=$1",[rid]);
    expect(Number(audits[0].n)).toBe(1);
    await expect(db.command(admin,'admin.reserve',{studentId:actor.studentId,sessionId:session.id},null,opKey)).rejects.toMatchObject({code:'PT409',message:'IDEMPOTENCY_CONFLICT'});
  });
  test('archived-student admin cancellation still enforces RBAC, policy, cancellation window and original rejected intent',async()=> {
    await configure(testPolicies);
    const actor=await db.actor();const other=await db.actor();
    const session=await createClass(1,'none','published',undefined,new Date(Date.now()-60000).toISOString());
    const created=await reserve(actor,session);const rid=resourceId(created);
    await db.command(admin,'admin.students.archive',{},actor.studentId,null,1);
    await expect(db.command(other,'admin.cancel',{},rid,key())).rejects.toMatchObject({code:'PT403'});
    expect((await db.command(other,'cancel',{},rid,key())).error).toEqual({code:'NOT_FOUND'});
    try {
      await configure({...testPolicies,adminOnBehalf:{mode:'unconfigured'}});
      const rejectedKey=key();
      const rejected=await db.command(admin,'admin.cancel',{},rid,rejectedKey);
      expect(rejected.error).toEqual({code:'ADMIN_ON_BEHALF_UNCONFIGURED_OR_DENIED'});
      await configure({...testPolicies,adminOnBehalf:{mode:'restricted',allowed:false}});
      expect((await db.command(admin,'admin.cancel',{},rid,key())).error).toEqual({code:'ADMIN_ON_BEHALF_UNCONFIGURED_OR_DENIED'});
      // This past-start fixture is bookable only because TEST booking policy is unrestricted.
      await configure({...testPolicies,cancellation:{mode:'restricted',minNoticeMinutes:0}});
      expect((await db.command(admin,'admin.cancel',{},rid,key())).error).toEqual({code:'CANCELLATION_WINDOW'});
      expect(await confirmed(session.id)).toBe(1);
      await configure(testPolicies);
      const replay=await db.command(admin,'admin.cancel',{},rid,rejectedKey);
      expect(replay).toMatchObject({outcome:'rejected',replayed:true,error:{code:'ADMIN_ON_BEHALF_UNCONFIGURED_OR_DENIED'}});
      expect(await confirmed(session.id)).toBe(1);
      expect((await db.command(admin,'admin.cancel',{},rid,key())).outcome).toBe('applied');
      expect((await db.read(admin,'admin.students',actor.studentId)).archivedAt).not.toBeNull();
    } finally {await configure(testPolicies);}
  });
  test('capacity cannot drop below confirmed count; stale version cannot overwrite a newer edit',async()=> {
    const session=await createClass(2); await reserve(await db.actor(),session); await reserve(await db.actor(),session);
    await expect(db.command(admin,'admin.sessions.update',{capacity:1},session.id as string,null,1)).rejects.toMatchObject({message:'CAPACITY_BELOW_RESERVATIONS'});
    await db.command(admin,'admin.sessions.update',{title:'TEST renamed'},session.id as string,null,1);
    await expect(db.command(admin,'admin.sessions.update',{title:'lost update'},session.id as string,null,1)).rejects.toMatchObject({message:'VERSION_CONFLICT'});
  });
  test('publication of overlapping shared bikes from concurrent transactions permits only one',async()=> {
    const bike=(await db.command(admin,'admin.bikes.create',{label:`B-${key()}`.slice(0,40)})).id as string;
    const a=await createClass(1,'none','draft',[bike]); const b=await createClass(1,'none','draft',[bike]);
    const outcomes=await Promise.allSettled([a,b].map(s=>db.command(admin,'admin.sessions.update',{status:'published'},s.id as string,null,1)));
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    const rejected=outcomes.find(x=>x.status==='rejected') as PromiseRejectedResult; expect(rejected.reason.message).toBe('BIKE_SCHEDULE_OVERLAP');
    await expect(db.command(admin,'admin.bikes.archive',{},bike,null,1)).rejects.toMatchObject({message:'RESOURCE_IN_USE'});
  });
  test('bike selection, inventory FK and no automatic assignment are enforced',async()=> {
    const session=await createClass(1,'required'); const actor=await db.actor();
    expect((await reserve(actor,session)).error).toEqual({code:'BIKE_REQUIRED'});
    expect((await reserve(actor,session,randomUUID())).error).toEqual({code:'BIKE_NOT_IN_SESSION'});
    const none=await createClass(); expect((await reserve(actor,none)).currentResource).toMatchObject({bikeId:null});
  });
  test('attendance is unmarked until explicit present/absent; clearing does not invent absence',async()=> {
    const actor=await db.actor(); const session=await createClass(); const created=await reserve(actor,session); const rid=resourceId(created);
    expect((created.resource as Json).attendance).toBe('unmarked');
    const present=await db.command(admin,'admin.attendance.mark',{status:'present'},rid,null,1); expect(present.attendance).toBe('present');
    expect((await db.command(admin,'admin.attendance.clear',{},rid,null,2)).attendance).toBe('unmarked');
    await expect(db.command(actor,'admin.attendance.mark',{status:'absent'},rid,null,3)).rejects.toMatchObject({code:'PT403'});
  });
  test('explicit restricted policies enforce time, cancellation, cross-session limit and admin denial',async()=> {
    const a=await createClass(); const b=await createClass(); const actor=await db.actor();
    await configure({...testPolicies,eligibility:{mode:'restricted',maxActiveReservations:1},adminOnBehalf:{mode:'restricted',allowed:false}});
    const results=await Promise.all([reserve(actor,a),reserve(actor,b)]); expect(results.filter(x=>x.outcome==='applied')).toHaveLength(1);
    expect(results.some(x=>(x.error as Json)?.code==='RESERVATION_LIMIT')).toBe(true);
    expect((await db.command(admin,'admin.reserve',{sessionId:a.id,studentId:actor.studentId},null,key())).error).toEqual({code:'ADMIN_ON_BEHALF_UNCONFIGURED_OR_DENIED'});
    await configure({...testPolicies,bookingWindow:{mode:'restricted',minNoticeMinutes:0,maxAdvanceMinutes:60},cancellation:{mode:'restricted',minNoticeMinutes:5256000}});
    const openSession=results[0].outcome==='applied'?b:a;
    expect((await reserve(await db.actor(),openSession)).error).toEqual({code:'BOOKING_WINDOW'});
    const applied=results.find(x=>x.outcome==='applied')!;
    expect((await db.command(actor,'cancel',{},resourceId(applied),key())).error).toEqual({code:'CANCELLATION_WINDOW'});
    await configure(testPolicies);
  });
  test('unrestricted explicitly permits past start; no invented cutoff and archived history is preserved',async()=> {
    await configure(testPolicies);
    const session=await createClass(1,'none','published',undefined,'2020-01-01T12:00:00Z'); const actor=await db.actor();
    const created=await reserve(actor,session); expect(created.outcome).toBe('applied');
    await db.command(admin,'admin.students.archive',{},actor.studentId,null,1);
    expect(await confirmed(session.id)).toBe(1); // Archive is NOT a hidden cancellation or hard delete.
    expect((await db.read(admin,'admin.reservations',resourceId(created))).status).toBe('confirmed');
  });
});

test('cancelled history RPC filters before pagination and isolates the authenticated student',async()=> {
  await configure(testPolicies);
  const readCancelled=(actor:Actor,limit=30,offset=0,sessionId:string|null=null) => db.as(actor,async c =>
    (await c.query('select public.studio_cancelled_history($1,$2,$3) result',[limit,offset,sessionId])).rows[0].result as Json);
  const actor=await db.actor(); const other=await db.actor();
  const sessions=await Promise.all(Array.from({length:5},()=>createClass()));
  const created=[];
  for(const session of sessions) created.push(resourceId(await reserve(actor,session)));
  for(const index of [0,2,4]) expect((await db.command(actor,'cancel',{},created[index],key())).outcome).toBe('applied');
  await db.command(admin,'admin.sessions.update',{status:'completed'},sessions[1].id as string,null,1);
  const otherSession=await createClass();const otherId=resourceId(await reserve(other,otherSession));
  await db.command(other,'cancel',{},otherId,key());
  const history=items(await db.read(actor,'reservations',null,{history:true}));
  expect(history.map(r=>r.id)).toEqual(expect.arrayContaining([created[0],created[2],created[4]]));
  expect(history).toEqual(expect.arrayContaining([expect.objectContaining({id:created[1],status:'confirmed'})]));
  const first=items(await readCancelled(actor,2,0));const second=items(await readCancelled(actor,2,2));
  expect(first).toHaveLength(2);expect(second).toHaveLength(1);
  expect(new Set([...first,...second].map(r=>r.id))).toEqual(new Set([created[0],created[2],created[4]]));
  expect([...first,...second].every(r=>r.status==='cancelled' && r.studentId===actor.studentId && 'session' in r)).toBe(true);
  expect(items(await readCancelled(actor,20,0,sessions[2].id as string)).map(r=>r.id)).toEqual([created[2]]);
  expect(items(await readCancelled(actor,20,0,otherSession.id as string))).toHaveLength(0);
  expect(items(await readCancelled(other)).map(r=>r.id)).toEqual([otherId]);
  await expect(db.as(null,c=>c.query('select public.studio_cancelled_history()'),'anon')).rejects.toMatchObject({code:'42501'});
  await expect(db.as(null,c=>c.query('select public.studio_cancelled_history()'),'service_role')).rejects.toMatchObject({code:'42501'});
  await expect(readCancelled(actor,101)).rejects.toMatchObject({code:'PT422'});
  await expect(readCancelled(actor,20,-1)).rejects.toMatchObject({code:'PT422'});
  await db.session(actor,'revoke');
  await expect(readCancelled(actor)).rejects.toMatchObject({code:'PT401'});
});

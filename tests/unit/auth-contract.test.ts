// Controlled provider contract tests. NOT a Supabase/GoTrue integration suite.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const fakes=vi.hoisted(()=> {
  const normal={ auth:{getUser:vi.fn(),getSession:vi.fn(),signUp:vi.fn(),signInWithPassword:vi.fn(),signOut:vi.fn(),exchangeCodeForSession:vi.fn(),verifyOtp:vi.fn()},rpc:vi.fn() };
  const recovery={auth:{getUser:vi.fn(),getSession:vi.fn(),resetPasswordForEmail:vi.fn(),updateUser:vi.fn(),signOut:vi.fn(),exchangeCodeForSession:vi.fn(),verifyOtp:vi.fn()},rpc:vi.fn()};
  const admin={auth:{admin:{inviteUserByEmail:vi.fn()}},rpc:vi.fn()};
  return {normal,recovery,admin,clear:vi.fn()};
});
vi.mock('@/lib/server/supabase',()=> ({serverClient:vi.fn(async(scope:string='normal')=> scope==='recovery'?fakes.recovery:fakes.normal),authAdminClient:vi.fn(()=>fakes.admin),clearAuthCookies:fakes.clear}));
import { handle } from '@/lib/server/router';
import { rpc } from '@/lib/server/rpc';
import { verifiedSession } from '@/modules/identity/service';
import { GET as callback } from '@/app/auth/callback/route';
import { POST as confirmForm } from '@/app/auth/confirm/route';
import { internalReturnTo, version } from '@/lib/server/http';
import { databaseError } from '@/lib/server/errors';
import { sessionSeriesCreate } from '@/contracts';

const userId=randomUUID(); const sessionId=randomUUID();
const identity={userId,studentId:randomUUID(),role:'student'};
const user={id:userId,email:'test@example.invalid'};
function jwt(exp=Math.floor(Date.now()/1000)+900) { return `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:userId,session_id:sessionId,exp})).toString('base64url')}.test-contract-only`; }
function request(path:string,method='GET',input?:unknown,headers:Record<string,string>={}) {
  const privateMutation=['POST','PATCH','PUT','DELETE'].includes(method) && /^(me|reservations|admin)(\/|\?|$)/.test(path);
  return new Request(`http://localhost:3000/api/v1/${path}`,{method,headers:{...(method==='GET'?{}:{origin:'http://localhost:3000','content-type':'application/json'}),...(privateMutation?{'x-expected-actor':userId}:{}),...headers},...(input===undefined?{}:{body:JSON.stringify(input)})});
}
async function api(path:string,method='GET',input?:unknown,headers:Record<string,string>={}) { return handle(request(path,method,input,headers),path.split('/')); }
beforeEach(()=> {
  vi.clearAllMocks();
  vi.stubEnv('APP_ENV','test'); vi.stubEnv('APP_ORIGIN','http://localhost:3000'); vi.stubEnv('SUPABASE_URL','http://127.0.0.1:54321'); vi.stubEnv('SUPABASE_PUBLISHABLE_KEY','test-key-placeholder'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-service-key-placeholder'); vi.stubEnv('RATE_LIMIT_SECRET','test-only-not-a-real-secret-1234567890');
  for (const client of [fakes.normal,fakes.recovery]) {
    client.auth.getUser.mockResolvedValue({data:{user},error:null});
    client.auth.getSession.mockResolvedValue({data:{session:{access_token:jwt()}},error:null});
    client.auth.signOut.mockResolvedValue({error:null});
    client.auth.exchangeCodeForSession.mockResolvedValue({data:{},error:null});
    client.auth.verifyOtp.mockResolvedValue({data:{},error:null});
  }
  fakes.normal.rpc.mockResolvedValue({data:identity,error:null});
  fakes.admin.rpc.mockResolvedValue({data:{allowed:true},error:null});
  fakes.normal.auth.signUp.mockResolvedValue({data:{session:null},error:null});
  fakes.normal.auth.signInWithPassword.mockResolvedValue({data:{},error:null});
  fakes.recovery.auth.resetPasswordForEmail.mockResolvedValue({data:{},error:null});
  fakes.recovery.auth.updateUser.mockResolvedValue({data:{user},error:null});
});

describe('BFF auth/authorization and no token disclosure',()=> {
  test('cancelledOnly routes only authenticated me/history=true to the read-only RPC',async()=> {
    const filtered=await handle(request('me/reservations?history=true&cancelledOnly=true&limit=20&offset=40'),['me','reservations']);
    expect(filtered.status).toBe(200);
    expect(fakes.normal.rpc).toHaveBeenCalledWith('studio_cancelled_history',{p_limit:20,p_offset:40,p_session_id:null});
    fakes.normal.rpc.mockClear();
    const sessionFilter=randomUUID();
    expect((await handle(request(`me/reservations?history=true&cancelledOnly=true&sessionId=${sessionFilter}`),['me','reservations'])).status).toBe(200);
    expect(fakes.normal.rpc).toHaveBeenCalledWith('studio_cancelled_history',{p_limit:30,p_offset:0,p_session_id:sessionFilter});
    fakes.normal.rpc.mockClear();
    expect((await handle(request('me/reservations?history=true&limit=20'),['me','reservations'])).status).toBe(200);
    expect(fakes.normal.rpc).toHaveBeenCalledWith('studio_read',expect.objectContaining({p_resource:'reservations',p_query:{history:true,limit:20}}));
    expect(fakes.normal.rpc.mock.calls.some(([name])=>name==='studio_cancelled_history')).toBe(false);
    for(const query of ['cancelledOnly=true','history=false&cancelledOnly=true','history=true&cancelledOnly=false']) {
      const response=await handle(request(`me/reservations?${query}`),['me','reservations']);
      expect(response.status).toBe(422);
    }
    const other=await handle(request('sessions?cancelledOnly=true'),['sessions']);
    expect(other.status).toBe(422);
    fakes.normal.rpc.mockResolvedValue({data:{...identity,role:'admin'},error:null});
    const admin=await handle(request('admin/reservations?cancelledOnly=true'),['admin','reservations']);
    expect(admin.status).toBe(422);
    expect(fakes.normal.rpc.mock.calls.some(([name])=>name==='studio_cancelled_history')).toBe(false);
  });
  test('private mutations require a valid expected actor; missing/malformed headers cause no command or external effect',async()=> {
    for(const value of [null,'','not-a-uuid',`${userId},${randomUUID()}`]) {
      const req=request('reservations','POST',{sessionId:randomUUID()},{'idempotency-key':'held-intention-key'});
      if(value===null) req.headers.delete('x-expected-actor'); else req.headers.set('x-expected-actor',value);
      const response=await handle(req,['reservations']);
      expect(response.status).toBe(422);expect((await response.json()).error.code).toBe('EXPECTED_ACTOR_REQUIRED');
    }
    expect(fakes.normal.rpc.mock.calls.every(([name])=>name==='studio_session')).toBe(true);
    expect(fakes.admin.rpc).not.toHaveBeenCalled();expect(fakes.admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });
  test('stale A intent/current B rejects all private mutation families before body, idempotency, rate limit or invite',async()=> {
    const expectedA=randomUUID();const adminIdentity={...identity,role:'admin'};
    fakes.normal.rpc.mockResolvedValue({data:adminIdentity,error:null});
    const cases:[string,string][]=[
      ['me','PATCH'],['reservations','POST'],[`reservations/${randomUUID()}/cancel`,'POST'],
      ['admin/students','POST'],[`admin/students/${randomUUID()}`,'PATCH'],[`admin/bikes/${randomUUID()}`,'DELETE'],
      [`admin/reservations/${randomUUID()}/attendance`,'PUT'],[`admin/reservations/${randomUUID()}/attendance`,'DELETE'],
      [`admin/students/${randomUUID()}/invite`,'POST'],['admin/settings','PATCH'],
    ];
    for(const [path,method] of cases) {
      const response=await api(path,method,{}, {'x-expected-actor':expectedA,'idempotency-key':'held-intention-key','if-match':'"1"'});
      expect(response.status).toBe(409);
      const json=await response.json();expect(json.error.code).toBe('ACTOR_CHANGED');
      expect(JSON.stringify(json)).not.toContain(expectedA);expect(JSON.stringify(json)).not.toContain(userId);
    }
    expect(fakes.normal.rpc.mock.calls.every(([name])=>name==='studio_session')).toBe(true);
    expect(fakes.admin.rpc).not.toHaveBeenCalled();expect(fakes.admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });
  test('matching bindings reach reservation/profile/admin SQL with the same expected actor and preserve version/key',async()=> {
    fakes.normal.rpc.mockImplementation(async(name,args)=>({data:name==='studio_session'?{...identity,role:'admin'}:args.p_action==='reserve'?{outcome:'applied'}:{version:2},error:null}));
    expect((await api('reservations','POST',{sessionId:randomUUID()},{'idempotency-key':'matching-intent-key'})).status).toBe(200);
    expect(fakes.normal.rpc).toHaveBeenCalledWith('studio_command',expect.objectContaining({p_action:'reserve',p_key:'matching-intent-key',p_expected_actor:userId}));
    expect((await api('me','PATCH',{fullName:'TEST name'},{'if-match':'"1"'})).status).toBe(200);
    expect(fakes.normal.rpc).toHaveBeenCalledWith('studio_command',expect.objectContaining({p_action:'me.update',p_version:1,p_expected_actor:userId}));
    expect((await api('admin/bikes','POST',{label:'TEST bike'})).status).toBe(200);
    expect(fakes.normal.rpc).toHaveBeenCalledWith('studio_command',expect.objectContaining({p_action:'admin.bikes.create',p_expected_actor:userId}));
  });
  test('SQL ACTOR_CHANGED is a safe 409, not an idempotency rejection or retriable transaction',async()=> {
    fakes.normal.rpc.mockImplementation(async(name)=>name==='studio_session'?{data:identity,error:null}:{data:null,error:{code:'PT409',message:'ACTOR_CHANGED'}});
    const response=await api('reservations','POST',{sessionId:randomUUID()},{'idempotency-key':'matching-intent-key'});
    expect(response.status).toBe(409);expect((await response.json()).error).toMatchObject({code:'ACTOR_CHANGED'});
    expect(fakes.normal.rpc.mock.calls.filter(([name])=>name==='studio_command')).toHaveLength(1);
    expect(databaseError({code:'PT422',message:'EXPECTED_ACTOR_REQUIRED'})).toMatchObject({status:422,code:'EXPECTED_ACTOR_REQUIRED'});
  });
  test('matching invite binds its verified request session in the privileged SQL bridge, not the invitee ID',async()=> {
    const studentId=randomUUID();const inviteeId=randomUUID();
    fakes.normal.rpc.mockImplementation(async(name)=>({data:name==='studio_session'?{...identity,role:'admin'}:{id:studentId,userId:null,invited:false,archivedAt:null,contactEmail:'invite@example.invalid',version:1},error:null}));
    fakes.admin.auth.admin.inviteUserByEmail.mockResolvedValue({data:{user:{id:inviteeId}},error:null});
    const response=await api(`admin/students/${studentId}/invite`,'POST',{}, {'if-match':'"1"'});
    expect(response.status).toBe(200);
    expect(fakes.admin.rpc).toHaveBeenCalledWith('studio_auth_bridge',{p_action:'link_invitation',p_body:{studentId,userId:inviteeId,version:1,expectedActor:userId,requestSessionId:sessionId}});
  });
  test('signup rejects client promotion/unknown fields and uses only a server-owned metadata allowlist',async()=> {
    expect((await api('auth/signup','POST',{email:user.email,password:'test-password-1234',fullName:'Teste',role:'admin'})).status).toBe(422);
    expect(fakes.normal.auth.signUp).not.toHaveBeenCalled();
    const response=await api('auth/signup','POST',{email:user.email,password:'test-password-1234',fullName:'Teste'});
    expect(response.status).toBe(200);
    expect(fakes.normal.auth.signUp).toHaveBeenCalledWith({email:user.email,password:'test-password-1234',options:{data:{full_name:'Teste'},emailRedirectTo:'http://localhost:3000/auth/callback'}});
    expect(JSON.stringify(await response.json())).not.toMatch(/access_token|refresh_token|password/);
  });
  test('wrong login is generic 401, successful login validates provider user then registers DB guard',async()=> {
    fakes.normal.auth.signInWithPassword.mockResolvedValueOnce({error:{status:400,message:'private provider detail'}});
    const bad=await api('auth/login','POST',{email:user.email,password:'wrong'}); expect(bad.status).toBe(401); expect((await bad.json()).error.code).toBe('INVALID_CREDENTIALS');
    const success=await api('auth/login','POST',{email:user.email,password:'test-password-1234'}); expect(success.status).toBe(200);
    expect(fakes.normal.auth.getUser).toHaveBeenCalled(); expect(fakes.normal.rpc).toHaveBeenCalledWith('studio_session',{p_action:'register'});
    expect(await success.json()).toMatchObject({data:identity});
  });
  test('cookie-auth mutations reject absent/foreign Origin and cross-site before any provider invocation',async()=> {
    const foreign=await api('auth/login','POST',{email:user.email,password:'x'},{origin:'https://attacker.example'}); expect(foreign.status).toBe(403);
    const noOrigin=new Request('http://localhost:3000/api/v1/auth/logout',{method:'POST'});
    expect((await handle(noOrigin,['auth','logout'])).status).toBe(403);
    expect((await api('auth/logout','POST',undefined,{'sec-fetch-site':'cross-site'})).status).toBe(403);
    expect(fakes.normal.auth.signInWithPassword).not.toHaveBeenCalled(); expect(fakes.normal.auth.getUser).not.toHaveBeenCalled();
  });
  test('every private response is no-store; role isolation and provider validation are enforced',async()=> {
    const response=await api('session'); expect(response.headers.get('cache-control')).toContain('no-store'); expect(response.headers.get('vary')).toContain('Cookie');
    expect((await api('admin/students')).status).toBe(403);
    fakes.normal.auth.getUser.mockResolvedValueOnce({data:{user:null},error:{status:401}});
    expect((await api('sessions')).status).toBe(401);
  });
  test('profile allowlist, If-Match and body/query bounds are enforced on server',async()=> {
    expect((await api('me','PATCH',{role:'admin'},{'if-match':'"1"'})).status).toBe(422);
    expect((await api('me','PATCH',{fullName:'Updated'})).status).toBe(428);
    expect((await handle(request('sessions?limit=101'),['sessions'])).status).toBe(422);
    expect((await handle(request('sessions?limit=1&limit=2'),['sessions'])).status).toBe(422);
    expect((await api('me','PATCH',{fullName:'x'.repeat(262145)},{'if-match':'"1"'})).status).toBe(413);
  });
  test('HTTP reservation rejection preserves the committed operation; not_observed is not a final failure',async()=> {
    const rejection={outcome:'rejected',error:{code:'SESSION_FULL'},reference:null,currentResource:null,replayed:false};
    fakes.normal.rpc.mockImplementation(async(name)=>({data:name==='studio_session'?identity:name==='studio_command'?rejection:{state:'not_observed'},error:null}));
    const response=await api('reservations','POST',{sessionId:randomUUID()},{'idempotency-key':'test-operation-key'});
    expect(response.status).toBe(409);expect((await response.json()).error).toMatchObject({code:'SESSION_FULL',operation:rejection});
    const observation=await api('me/operations/test-operation-key');expect(observation.status).toBe(200);expect((await observation.json()).data).toEqual({state:'not_observed'});
    expect((await api('reservations','POST',{sessionId:randomUUID(),studentId:randomUUID()},{'idempotency-key':'test-operation-key'})).status).toBe(422);
  });
  test('logout persists DB revocation before provider logout; DB failure cannot falsely claim revocation',async()=> {
    const order:string[]=[];
    fakes.normal.rpc.mockImplementation(async()=>{order.push('database');return {data:{revoked:true},error:null};});
    fakes.normal.auth.signOut.mockImplementation(async()=>{order.push('provider');return {error:null};});
    expect((await api('auth/logout','POST')).status).toBe(200); expect(order).toEqual(['database','provider']);
    fakes.normal.rpc.mockResolvedValue({data:null,error:{code:'08006',message:'private SQL'}}); fakes.normal.auth.signOut.mockClear();
    expect((await api('auth/logout','POST')).status).toBe(503); expect(fakes.normal.auth.signOut).not.toHaveBeenCalled();
  });
  test('provider throttling/outage at logout cannot falsely report that an active JWT was revoked',async()=> {
    fakes.normal.auth.getUser.mockResolvedValueOnce({data:{user:null},error:{status:429,name:'AuthApiError'}});
    expect((await api('auth/logout','POST')).status).toBe(503); expect(fakes.normal.auth.signOut).not.toHaveBeenCalled();
    fakes.normal.auth.getUser.mockResolvedValueOnce({data:{user:null},error:{status:400,name:'AuthSessionMissingError'}});
    expect((await api('auth/logout','POST')).status).toBe(200);
  });
  test('recovery response is the same for nonexistent/valid address; upstream outage is not falsely successful',async()=> {
    const valid=await api('auth/recovery','POST',{email:'valid@example.invalid'});
    fakes.recovery.auth.resetPasswordForEmail.mockResolvedValueOnce({error:{status:400,message:'not found'}});
    const missing=await api('auth/recovery','POST',{email:'missing@example.invalid'});
    expect(valid.status).toBe(missing.status); expect((await valid.json()).data).toEqual((await missing.json()).data);
    fakes.recovery.auth.resetPasswordForEmail.mockResolvedValueOnce({error:{status:503}});
    expect((await api('auth/recovery','POST',{email:user.email})).status).toBe(503);
  });
  test('password reset cannot use an ordinary session without a recovery proof/grant',async()=> {
    fakes.recovery.auth.getUser.mockResolvedValueOnce({data:{user:null},error:{status:401}});
    expect((await api('auth/reset-password','POST',{password:'test-new-password-123'})).status).toBe(401);
    expect(fakes.recovery.auth.updateUser).not.toHaveBeenCalled();
    fakes.admin.rpc.mockImplementation(async(_name,args)=>args.p_action==='consume_recovery'?{data:null,error:{code:'PT401',message:'RECOVERY_INVALID'}}:{data:{allowed:true},error:null});
    expect((await api('auth/reset-password','POST',{password:'test-new-password-123'})).status).toBe(401);
    expect(fakes.recovery.auth.updateUser).not.toHaveBeenCalled();
  });
  test('expired JWT recovery proof is rejected even if the controlled provider says user is valid',async()=> {
    fakes.recovery.auth.getSession.mockResolvedValueOnce({data:{session:{access_token:jwt(1)}},error:null});
    await expect(verifiedSession(fakes.recovery as unknown as SupabaseClient)).rejects.toMatchObject({status:401});
  });
  test('reset consumes proof/revokes before provider update; technical failure instructs restart, not success',async()=> {
    const calls:string[]=[];
    fakes.admin.rpc.mockImplementation(async(_name,args)=>{calls.push(args.p_action);return {data:{allowed:true},error:null};});
    fakes.recovery.auth.updateUser.mockImplementation(async()=>{calls.push('provider-update');return {error:{status:503}};});
    const response=await api('auth/reset-password','POST',{password:'test-new-password-123'});
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('PASSWORD_UPDATE_FAILED_RESTART_RECOVERY');
    expect(calls.indexOf('consume_recovery')).toBeLessThan(calls.indexOf('revoke_user')); expect(calls.indexOf('revoke_user')).toBeLessThan(calls.indexOf('provider-update'));
  });
  test('PKCE recovery callback uses dedicated scope; a failed/replayed code cannot issue a grant',async()=> {
    fakes.recovery.auth.exchangeCodeForSession.mockResolvedValueOnce({error:{status:400}});
    const failed=await callback(new Request('http://localhost:3000/auth/callback?flow=recovery&code=replayed&next=https://evil.example'));
    expect(failed.headers.get('location')).toBe('http://localhost:3000/auth/result?status=invalid_link'); expect(fakes.admin.rpc).not.toHaveBeenCalled();
    const success=await callback(new Request('http://localhost:3000/auth/callback?flow=recovery&code=controlled-test-code&next=https://evil.example'));
    expect(success.headers.get('location')).toBe('http://localhost:3000/auth/result?status=recovery_verified');
    expect(fakes.admin.rpc).toHaveBeenCalledWith('studio_auth_bridge',{p_action:'recovery_grant',p_body:{userId,sessionId}});
    expect(fakes.normal.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  test('unconfigured callback returns private 503, not an unhandled Next 500 or successful login',async()=> {
    vi.stubEnv('APP_ORIGIN','');
    const response=await callback(new Request('http://localhost:3000/auth/callback?code=controlled-code'));
    expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toContain('no-store');
    expect(fakes.normal.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  test('token-hash confirmation fixes the provider proof type on the server',async()=> {
    expect((await api('auth/confirm','POST',{type:'recovery',tokenHash:'controlled-test-token-hash'})).status).toBe(200);
    expect(fakes.recovery.auth.verifyOtp).toHaveBeenCalledWith({token_hash:'controlled-test-token-hash',type:'recovery'});
    expect((await api('auth/confirm','POST',{type:'magiclink',tokenHash:'controlled-test-token-hash'})).status).toBe(422);
  });
  test('HTML confirmation consumes proof only on same-origin POST and hands recovery to a fixed UI path',async()=> {
    const response = await confirmForm(new Request('http://localhost:3000/auth/confirm', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/x-www-form-urlencoded' }, body: 'tokenHash=controlled-test-token-hash&type=recovery' }));
    expect(response.status).toBe(303); expect(response.headers.get('location')).toBe('/auth/result?status=recovery_verified'); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(fakes.recovery.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'controlled-test-token-hash', type: 'recovery' });
    expect(fakes.normal.auth.verifyOtp).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('access_token');
  });
  test('HTML confirmation rejection remains an HTTP error and never grants recovery on foreign Origin',async()=> {
    const response = await confirmForm(new Request('http://localhost:3000/auth/confirm', { method: 'POST', headers: { origin: 'https://foreign.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'tokenHash=controlled-test-token-hash&type=recovery' }));
    expect(response.status).toBe(403); expect(response.headers.get('content-type')).toContain('text/html'); expect(fakes.recovery.auth.verifyOtp).not.toHaveBeenCalled(); expect(fakes.admin.rpc).not.toHaveBeenCalled();
  });
  test('weekly series POST has a strict finite contract and forwards actor/key to its one RPC',async()=> {
    const input={title:'TEST weekly',instructorId:randomUUID(),startDate:'2035-01-01',startTime:'07:00',
      endDate:'2035-01-01',endTime:'08:00',untilDate:'2035-01-15',timezone:'America/Sao_Paulo',
      capacity:1,bikeMode:'none',bikeIds:[randomUUID()],status:'draft'};
    fakes.normal.rpc.mockImplementation(async(name,args)=>({data:name==='studio_session'?{...identity,role:'admin'}:
      name==='studio_create_session_series'?{id:randomUUID(),occurrenceCount:3,firstStartsAt:'2035-01-01T10:00:00Z',lastStartsAt:'2035-01-15T10:00:00Z'}:args,error:null}));
    expect(sessionSeriesCreate.safeParse(input).success).toBe(true);
    for(const invalid of [
      {...input,untilDate:'2036-01-01'}, {...input,startTime:'7:00'}, {...input,untilDate:'2034-12-31'},
      {...input,endDate:'2034-12-31'}, {...input,status:'cancelled'}, {...input,unexpected:true},
    ]) expect(sessionSeriesCreate.safeParse(invalid).success).toBe(false);
    expect((await api('admin/session-series','POST',input)).status).toBe(422);
    expect((await api('admin/session-series','POST',input,{'idempotency-key':'series-test-key','x-expected-actor':randomUUID()})).status).toBe(409);
    expect(fakes.normal.rpc.mock.calls.some(([name])=>name==='studio_create_session_series')).toBe(false);
    const response=await api('admin/session-series','POST',input,{'idempotency-key':'series-test-key'});
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({occurrenceCount:3,id:expect.any(String)});
    expect(fakes.normal.rpc).toHaveBeenCalledWith('studio_create_session_series',{
      p_body:input,p_key:'series-test-key',p_expected_actor:userId,
    });
    expect((await api('admin/session-series','POST',{...input,status:'completed'},{'idempotency-key':'series-new-key'})).status).toBe(422);
  });
  test('HTML confirmation errors never log provider details or recovery tokens',async()=> {
    const log = vi.spyOn(console,'error').mockImplementation(()=>{});
    const confirm = () => confirmForm(new Request('http://localhost:3000/auth/confirm', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/x-www-form-urlencoded' }, body: 'tokenHash=controlled-test-token-hash&type=recovery' }));
    try {
      fakes.recovery.auth.verifyOtp.mockResolvedValueOnce({error:{message:'private provider detail controlled-test-token-hash'}});
      expect((await confirm()).status).toBe(401);
      fakes.admin.rpc.mockImplementation(async(_name,args)=>args.p_action==='recovery_grant'?{data:null,error:{code:'XX000',message:'private grant detail controlled-test-token-hash'}}:{data:{allowed:true},error:null});
      expect((await confirm()).status).toBe(503);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private provider detail|private grant detail|controlled-test-token-hash/);
    } finally { log.mockRestore(); }
  });
  test('persistent rate limiter denial returns 429 without invoking signIn',async()=> {
    fakes.admin.rpc.mockResolvedValueOnce({data:{allowed:false},error:null});
    const response=await api('auth/login','POST',{email:user.email,password:'x'}); expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60'); expect(fakes.normal.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('transaction retries and safe contracts',()=> {
  test('retry is bounded to three whole RPC transactions, with the identical idempotency key',async()=> {
    fakes.normal.rpc.mockResolvedValueOnce({error:{code:'40P01'}}).mockResolvedValueOnce({error:{code:'40001'}}).mockResolvedValueOnce({data:{ok:true},error:null});
    const args={p_action:'reserve',p_key:'same-key-test',p_body:{sessionId:randomUUID()},p_expected_actor:userId};
    expect(await rpc(fakes.normal as unknown as SupabaseClient,'studio_command',args,true)).toEqual({ok:true});
    expect(fakes.normal.rpc).toHaveBeenCalledTimes(3); for(const call of fakes.normal.rpc.mock.calls) expect(call).toEqual(['studio_command',args]);
  });
  test('ambiguous transport failure is NOT automatically retried or reported as a final rejection',async()=> {
    fakes.normal.rpc.mockResolvedValue({error:{code:'',message:'Failed to fetch private URL'}});
    await expect(rpc(fakes.normal as unknown as SupabaseClient,'studio_command',{},true)).rejects.toMatchObject({status:503}); expect(fakes.normal.rpc).toHaveBeenCalledTimes(1);
    expect(databaseError({code:'XX000',message:'SQL password detail'}).message).toBe('SERVICE_UNAVAILABLE');
  });
  test('return targets are internal allowlisted paths; If-Match rejects weak/wildcard versions',()=> {
    expect(internalReturnTo('/aluno/agenda')).toBe('/aluno/agenda');
    for(const target of ['//evil.example','https://evil.example','/api/v1/auth/logout','/aluno/agenda?next=//evil','/\\evil']) expect(()=>internalReturnTo(target)).toThrow();
    for(const match of ['*','W/"1"','1','"-1"']) expect(()=>version(new Request('http://localhost',{headers:{'if-match':match}}))).toThrow();
  });
});

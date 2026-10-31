// Opt-in destructive TEST-data creation. Refuses non-loopback URLs and APP_ENV != test.
// Requires an isolated local Supabase + migrated DB + running Next BFF. No credentials logged.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

async function main() {
  const { APP_ENV, APP_ORIGIN, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const local = (value?: string) => { try {return ['localhost','127.0.0.1','[::1]'].includes(new URL(value!).hostname);} catch {return false;} };
  if (APP_ENV !== 'test' || !local(APP_ORIGIN) || !local(SUPABASE_URL) || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('BLOCKED: requires APP_ENV=test, loopback APP_ORIGIN/SUPABASE_URL, and local Supabase keys. Nothing executed.');
    process.exitCode=2; return;
  }
  const admin=createClient(SUPABASE_URL!,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const jar=new Map<string,string>();
  async function api(path:string,method='GET',input?:unknown) {
    const res=await fetch(`${APP_ORIGIN}/api/v1/${path}`,{method,redirect:'manual',headers:{origin:APP_ORIGIN!,'content-type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},...(input===undefined?{}:{body:JSON.stringify(input)})});
    for(const value of res.headers.getSetCookie()) {
      assert.match(value,/HttpOnly/i); assert.match(value,/SameSite=Lax/i);
      const first=value.split(';')[0];const index=first.indexOf('=');jar.set(first.slice(0,index),decodeURIComponent(first.slice(index+1)));
    }
    assert.match(res.headers.get('cache-control')??'',/no-store/);
    const json=await res.json(); assert.ok(!JSON.stringify(json).includes('access_token')); assert.ok(!JSON.stringify(json).includes('refresh_token'));
    return {res,json};
  }
  const email=`provider-test-${randomUUID()}@example.invalid`; const password=`TEST-${randomUUID()}-aA9`;
  assert.equal((await api('auth/signup','POST',{email,password,fullName:'TEST provider',role:'admin'})).res.status,422);
  assert.equal((await api('auth/signup','POST',{email,password,fullName:'TEST provider'})).res.status,200);
  const listing=await admin.auth.admin.listUsers({perPage:1000}); assert.ifError(listing.error);
  const user=listing.data.users.find(u=>u.email===email);assert.ok(user,'Local provider did not persist signup');
  assert.ifError((await admin.auth.admin.updateUserById(user.id,{email_confirm:true})).error);
  assert.equal((await api('auth/login','POST',{email,password:'wrong-password'})).res.status,401);
  assert.equal((await api('auth/login','POST',{email,password})).res.status,200);
  assert.equal((await api('session')).json.data.role,'student');
  assert.equal((await api('admin/students')).res.status,403);
  const ssr=createServerClient(SUPABASE_URL!,SUPABASE_PUBLISHABLE_KEY,{cookieOptions:{name:'studio-auth'},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:()=>{}}});
  const oldToken=(await ssr.auth.getSession()).data.session?.access_token; assert.ok(oldToken);
  const direct=createClient(SUPABASE_URL!,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${oldToken}`}}});
  assert.ifError((await direct.rpc('studio_read',{p_resource:'sessions'})).error);
  assert.ok((await direct.rpc('studio_auth_bridge',{p_action:'revoke_user',p_body:{userId:user.id}})).error);
  assert.equal((await api('auth/logout','POST')).res.status,200);
  assert.equal((await direct.rpc('studio_read',{p_resource:'sessions'})).error?.code,'PT401');
  assert.equal((await direct.rpc('studio_session',{p_action:'register'})).error?.code,'PT401');
  assert.equal((await api('session')).res.status,401);
  const known=await api('auth/recovery','POST',{email});
  const unknown=await api('auth/recovery','POST',{email:`absent-${randomUUID()}@example.invalid`});
  assert.equal(known.res.status,200);assert.equal(unknown.res.status,200);assert.deepEqual(known.json.data,unknown.json.data);
  // Real provider OTP verification; deliberately does NOT claim SMTP delivery verification.
  const link=await admin.auth.admin.generateLink({type:'recovery',email});assert.ifError(link.error);
  const tokenHash=link.data.properties.hashed_token;
  assert.equal((await api('auth/confirm','POST',{type:'recovery',tokenHash})).res.status,200);
  assert.equal((await api('auth/confirm','POST',{type:'recovery',tokenHash})).res.status,401);
  // Replay cleared recovery cookies. Obtain a fresh proof for the actual reset.
  const second=await admin.auth.admin.generateLink({type:'recovery',email});assert.ifError(second.error);
  assert.equal((await api('auth/confirm','POST',{type:'recovery',tokenHash:second.data.properties.hashed_token})).res.status,200);
  const newPassword=`TEST-${randomUUID()}-aA9`;
  assert.equal((await api('auth/reset-password','POST',{password:newPassword})).res.status,200);
  assert.equal((await api('auth/reset-password','POST',{password:newPassword})).res.status,401);
  assert.equal((await api('auth/login','POST',{email,password})).res.status,401);
  assert.equal((await api('auth/login','POST',{email,password:newPassword})).res.status,200);
  await api('auth/logout','POST');
  console.log('PASS: real local Supabase signup/login, roles, HttpOnly cookies, logout/direct-JWT denial, generic recovery, OTP replay and password reset. TEST records retained; reset the isolated local stack to remove them. SMTP delivery not tested.');
}
main().catch(()=>{console.error('FAIL: local Supabase integration smoke failed. Inspect sanitized BFF request IDs/provider local logs; no credentials printed.');process.exitCode=1;});

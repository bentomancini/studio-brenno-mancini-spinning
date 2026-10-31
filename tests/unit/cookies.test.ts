// The REAL Supabase SSR client against a controlled HTTP protocol fixture, NOT GoTrue.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const store=vi.hoisted(()=> ({values:new Map<string,string>(),writes:[] as {name:string;value:string;options:Record<string,unknown>}[]}));
vi.mock('next/headers',()=> ({cookies:async()=>({getAll:()=>[...store.values].map(([name,value])=>({name,value})),set:(name:string,value:string,options:Record<string,unknown>)=>{store.values.set(name,value);store.writes.push({name,value,options});}})}));
import { clearAuthCookies, serverClient } from '@/lib/server/supabase';

const uid=randomUUID(); const sid=randomUUID();
const user={id:uid,email:'test@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
function token(exp=Math.floor(Date.now()/1000)+3600) { return `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:uid,session_id:sid,exp})).toString('base64url')}.fake-fixture-signature`; }
beforeEach(()=> {
  store.values.clear();store.writes.length=0;
  vi.stubEnv('APP_ENV','test');vi.stubEnv('APP_ORIGIN','http://localhost:3000');vi.stubEnv('SUPABASE_URL','http://127.0.0.1:54321');vi.stubEnv('SUPABASE_PUBLISHABLE_KEY','fixture-key-placeholder');
});
afterEach(()=> {vi.unstubAllGlobals();vi.unstubAllEnvs();});
test('SSR cookies are HttpOnly/SameSite, per-scope; new requests validate user and refresh rotates cookies',async()=> {
  let refreshes=0; let validations=0;
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=> {
    const url=input.toString();
    if(url.includes('/token')) {if(url.includes('refresh_token'))refreshes++;return Response.json({access_token:token(),refresh_token:`fixture-refresh-${refreshes}`,token_type:'bearer',expires_in:3600,user});}
    if(url.includes('/user')){validations++;return Response.json(user);}
    if(url.includes('/recover'))return Response.json({});
    throw new Error('Unexpected test protocol request');
  }));
  const client=await serverClient(); const login=await client.auth.signInWithPassword({email:user.email,password:'fixture-password'}); expect(login.error).toBeNull();
  expect(store.writes.some(w=>w.name.startsWith('studio-auth'))).toBe(true);
  expect(store.writes.every(w=>w.options.httpOnly===true && w.options.sameSite==='lax' && w.options.path==='/')).toBe(true);
  const nextRequest=await serverClient(); expect((await nextRequest.auth.getUser()).data.user?.id).toBe(uid); expect(validations).toBeGreaterThan(0);
  expect((await nextRequest.auth.refreshSession()).error).toBeNull(); expect(refreshes).toBe(1);
  // Expire the controlled SSR cookie fixture, then validate a NEW request using the real SDK.
  const stored=[...store.values].find(([name,value])=>name==='studio-auth' && value.startsWith('base64-'));
  expect(stored).toBeDefined();
  const expired=JSON.parse(Buffer.from(stored![1].slice(7),'base64url').toString('utf8'));
  expired.expires_at=1;expired.access_token=token(1);
  store.values.set(stored![0],`base64-${Buffer.from(JSON.stringify(expired)).toString('base64url')}`);
  const refreshedRequest=await serverClient();expect((await refreshedRequest.auth.getUser()).data.user?.id).toBe(uid);expect(refreshes).toBe(2);
  const recovery=await serverClient('recovery'); await recovery.auth.resetPasswordForEmail(user.email,{redirectTo:'http://localhost:3000/auth/callback?flow=recovery'}).catch(()=>{});
  expect(store.writes.some(w=>w.name.startsWith('studio-recovery-code-verifier'))).toBe(true);
  await clearAuthCookies('normal');
  expect(store.writes.filter(w=>w.name.startsWith('studio-auth')).some(w=>w.options.maxAge===0)).toBe(true);
  expect([...store.values.keys()].some(n=>n.startsWith('studio-recovery'))).toBe(true);
});
test('production cookies always include Secure and HttpOnly, including cookie deletion',async()=> {
  vi.stubEnv('APP_ENV','production');vi.stubEnv('APP_ORIGIN','https://studio.example.invalid');vi.stubEnv('SUPABASE_URL','https://provider.example.invalid');
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({access_token:token(),refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user})));
  const client=await serverClient(); await client.auth.signInWithPassword({email:user.email,password:'fixture-password'});
  await clearAuthCookies('normal');
  expect(store.writes.length).toBeGreaterThan(0);expect(store.writes.every(w=>w.options.secure===true && w.options.httpOnly===true)).toBe(true);
});

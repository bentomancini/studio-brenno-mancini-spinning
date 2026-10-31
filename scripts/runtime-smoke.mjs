// Exercises the actual Next production HTTP runtime without requiring provider secrets.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
const port=listener.address().port;await new Promise(r=>listener.close(r));
const origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
  cwd:process.cwd(),env:{...process.env,APP_ENV:'test',APP_ORIGIN:origin,SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_PUBLISHABLE_KEY:'test-placeholder-not-a-secret',SUPABASE_SERVICE_ROLE_KEY:'test-placeholder-service-key',RATE_LIMIT_SECRET:'test-placeholder-rate-secret-1234567890'},stdio:'ignore',windowsHide:true,
});
try {
  let started=false;
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok){started=true;break;}}catch{ /* Expected while the child is starting. */ }await new Promise(r=>setTimeout(r,150));}
  assert.ok(started,'Next runtime failed to start');
  const page=await fetch(origin);assert.equal(page.status,200);assert.equal(page.headers.get('x-frame-options'),'DENY');assert.equal(page.headers.get('x-content-type-options'),'nosniff');assert.match(page.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);
  const session=await fetch(`${origin}/api/v1/session`);assert.equal(session.status,401);assert.match(session.headers.get('cache-control')??'',/no-store/);assert.ok(session.headers.get('x-request-id'));assert.equal((await session.json()).error.code,'UNAUTHENTICATED');
  for(const headers of [{origin:'https://foreign.example'},{}]) {
    const response=await fetch(`${origin}/api/v1/auth/logout`,{method:'POST',headers});assert.equal(response.status,403);assert.equal((await response.json()).error.code,'CSRF_REJECTED');
  }
  const promotion=await fetch(`${origin}/api/v1/auth/signup`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'fixture@example.invalid',password:'test-password-123',fullName:'TEST',role:'admin'})});assert.equal(promotion.status,422);
  const invalidConfirm=await fetch(`${origin}/auth/confirm?token_hash=<script>&type=invite`);assert.equal(invalidConfirm.status,422);assert.match(invalidConfirm.headers.get('cache-control')??'',/no-store/);assert.ok(!(await invalidConfirm.text()).includes('<script>'));
  console.log('PASS: actual Next production HTTP runtime, security headers, private no-store/401, CSRF Origin, signup allowlist, safe confirmation callback. No real identity provider used.');
} finally {child.kill();await new Promise(r=>child.once('exit',r));}

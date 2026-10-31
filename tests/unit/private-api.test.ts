// UI context tests only. SQL's atomic comparison is exercised by browser/BFF
// regressions, not replaced with this controlled transport in app runtime.
import { afterEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SessionIdentity } from '@/contracts';
import { api } from '@/lib/ui/api';
import { createPrivateApi } from '@/lib/ui/private-api';
import { invalidateIntentScopes, openIntentScope, ownsIntentScope } from '@/lib/ui/intent-store';

const identity: SessionIdentity = { userId: randomUUID(), studentId: randomUUID(), role: 'student' };
const other: SessionIdentity = { userId: randomUUID(), studentId: randomUUID(), role: 'student' };
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const deferred = () => { let resolve!: (response: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => { vi.unstubAllGlobals(); invalidateIntentScopes(); });

test('domain transport fails closed without an expected actor; auth and reads keep their contract', async () => {
  const fetcher = vi.fn().mockImplementation(async () => ok({})); vi.stubGlobal('fetch', fetcher);
  for (const path of ['me', 'reservations', 'reservations/id/cancel', 'admin/settings']) for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    await expect(api(path, { method, body: {} })).rejects.toMatchObject({ code: 'EXPECTED_ACTOR_REQUIRED', status: 422 });
  }
  expect(fetcher).not.toHaveBeenCalled();
  await api('auth/logout', { method: 'POST', body: {} }); await api('session');
  for (const [, options] of fetcher.mock.calls) expect(options.headers).not.toHaveProperty('X-Expected-Actor');
});

test('verification blocks synchronously and never queues/replays a blocked mutation', async () => {
  const check = deferred(); const fetcher = vi.fn().mockReturnValueOnce(check.promise).mockImplementation(async () => ok({ saved: true })); vi.stubGlobal('fetch', fetcher);
  const bound = createPrivateApi(identity); const verifying = bound.verify();
  expect(bound.getStatus()).toBe('checking'); await expect(bound.request('me', { method: 'PATCH', body: { fullName: 'TEST' } })).rejects.toMatchObject({ code: 'ACTOR_UNVERIFIED' }); expect(fetcher).toHaveBeenCalledTimes(1);
  check.resolve(ok(identity)); await verifying; expect(bound.getStatus()).toBe('verified'); expect(fetcher).toHaveBeenCalledTimes(1);
  await bound.request('me', { method: 'PATCH', body: { fullName: 'TEST' }, version: 1 });
  expect(fetcher.mock.calls[1][1].headers['X-Expected-Actor']).toBe(identity.userId);
});

test('refocus check failure remains unverified, but a later successful check permits a new explicit action', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(ok(identity)).mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(ok(identity)).mockResolvedValueOnce(ok({})); vi.stubGlobal('fetch', fetcher);
  const bound = createPrivateApi(identity); await bound.verify(); await bound.verify();
  expect(bound.getStatus()).toBe('unverified'); await expect(bound.request('admin/bikes', { method: 'POST', body: { label: 'TEST' } })).rejects.toMatchObject({ code: 'ACTOR_UNVERIFIED' });
  await bound.verify(); expect(fetcher).toHaveBeenCalledTimes(3); await bound.request('me', { method: 'PATCH', body: { phone: null } }); expect(fetcher).toHaveBeenCalledTimes(4);
});

test('the original actor is immutable across cookie changes, idempotent retry and supplied options', async () => {
  const key = randomUUID(); const body = { sessionId: randomUUID() };
  const fetcher = vi.fn().mockResolvedValueOnce(ok(identity)).mockRejectedValueOnce(new TypeError('interrupted')).mockResolvedValueOnce(ok({})); vi.stubGlobal('fetch', fetcher);
  const supplied = { ...identity }; const bound = createPrivateApi(supplied); await bound.verify();
  await expect(bound.request('reservations', { method: 'POST', body, key })).rejects.toMatchObject({ ambiguous: true });
  supplied.userId = other.userId; // New cookies/identity must not rebind this draft.
  await bound.request('reservations', { method: 'POST', body, key, ...{ expectedActor: other.userId } });
  expect(fetcher.mock.calls[1][1].headers['X-Expected-Actor']).toBe(identity.userId); expect(fetcher.mock.calls[2][1].headers).toEqual(fetcher.mock.calls[1][1].headers); expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[1][1].body);
});

test('ACTOR_CHANGED on a write retires its lease, retains the intended actor and prevents automatic retry', async () => {
  const lease = openIntentScope(identity.userId); const fetcher = vi.fn().mockResolvedValueOnce(ok(identity)).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'ACTOR_CHANGED' } }), { status: 409 })); vi.stubGlobal('fetch', fetcher);
  const bound = createPrivateApi(identity); await bound.verify();
  await expect(bound.request('reservations', { method: 'POST', key: randomUUID(), body: { sessionId: randomUUID() } })).rejects.toMatchObject({ code: 'ACTOR_CHANGED' });
  expect(bound.getStatus()).toBe('changed'); expect(ownsIntentScope(lease)).toBe(false); expect(bound.actor).toBe(identity.userId);
  await bound.verify(); await expect(bound.request('me', { method: 'PATCH', body: { phone: null } })).rejects.toMatchObject({ code: 'ACTOR_CHANGED' }); expect(fetcher).toHaveBeenCalledTimes(2);
});

test('late positive verification cannot replace a newer mismatch or resurrect a retired context', async () => {
  const stale = deferred(); const fetcher = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce(ok(other)); vi.stubGlobal('fetch', fetcher);
  const bound = createPrivateApi(identity); const previous = bound.verify(); bound.pause(); await bound.verify(); stale.resolve(ok(identity)); await previous;
  expect(bound.getStatus()).toBe('changed');
  const late = deferred(); fetcher.mockReturnValueOnce(late.promise); const retired = createPrivateApi(identity); const verifying = retired.verify(); retired.dispose(); late.resolve(ok(identity)); await verifying;
  await expect(retired.request('me', { method: 'PATCH', body: { phone: null } })).rejects.toMatchObject({ code: 'ACTOR_UNVERIFIED' });
});

test('a stale actor check does not invalidate an already active lease for another actor', async () => {
  const lease = openIntentScope(other.userId); const fetcher = vi.fn().mockResolvedValueOnce(ok(other)); vi.stubGlobal('fetch', fetcher);
  const bound = createPrivateApi(identity); await bound.verify(); expect(bound.getStatus()).toBe('changed'); expect(ownsIntentScope(lease)).toBe(true);
});

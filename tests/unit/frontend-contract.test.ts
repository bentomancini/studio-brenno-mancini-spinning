import { afterEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { listQuery, type OperationResult, type ReservationDTO } from '@/contracts';
import { api, errorMessage, RequestError } from '@/lib/ui/api';
import { authoritativeResource, intentRequest, operationMessage, readIntents, type Intent } from '@/lib/ui/intent';
import { safeReturnTo } from '@/lib/ui/navigation';
import { browserRange, dateInZone, shiftDate, weekStart } from '@/lib/ui/format';
import { GET as handoff } from '@/app/auth/result/route';
import { GET as confirmation } from '@/app/auth/confirm/route';

afterEach(() => vi.unstubAllGlobals());
const actor = randomUUID(); const sessionId = randomUUID();
const intent: Intent = { action: 'reserve', sessionId, key: randomUUID(), bikeId: randomUUID() };
const reservation: ReservationDTO = { id: randomUUID(), sessionId, studentId: randomUUID(), bikeId: null, status: 'confirmed', createdAt: '2035-01-01T00:00:00Z', cancelledAt: null, version: 1, attendance: 'unmarked' };
describe('frontend booking safety, read models and navigation', () => {
  test('catalog query trims search and bounds its length and pagination', () => {
    expect(listQuery.parse({q:'  Maria  ',limit:'20',offset:'40'})).toMatchObject({q:'Maria',limit:20,offset:40});
    expect(listQuery.safeParse({q:'x'.repeat(121)}).success).toBe(false);
    expect(listQuery.safeParse({q:'Maria',offset:'100001'}).success).toBe(false);
  });
  test('durable intention roundtrips only for its actor and rejects arbitrary extra stored data', () => {
    const raw = JSON.stringify({ actor, items: [intent] });
    expect(readIntents(raw, actor)).toEqual([intent]); expect(readIntents(raw, randomUUID())).toEqual([]);
    expect(readIntents(JSON.stringify({ actor, items: [{ ...intent, password: 'forbidden' }] }), actor)).toEqual([]);
    expect(readIntents('bad JSON', actor)).toEqual([]);
  });
  test('retry serializes the exact operation/body without studentId in the student flow', () => {
    expect(intentRequest(intent)).toEqual({ path: 'reservations', body: { sessionId, bikeId: intent.bikeId } });
    expect(intentRequest({ ...intent, action: 'cancel', reservationId: reservation.id })).toEqual({ path: `reservations/${reservation.id}/cancel`, body: {} });
    expect(intentRequest({ ...intent, action: 'admin.reserve', studentId: reservation.studentId }).body).toMatchObject({ studentId: reservation.studentId });
  });
  test('cancelled current resource supersedes the historical create response, including explicit null', () => {
    const result: OperationResult = { outcome: 'applied', reference: { reservationId: reservation.id, sessionId }, resource: reservation, currentResource: { ...reservation, status: 'cancelled', version: 2 } };
    expect(operationMessage(result)).toContain('cancelada'); expect(operationMessage(result)).not.toContain('confirmada');
    expect(authoritativeResource({ ...result, currentResource: null })).toBeNull();
    expect(authoritativeResource(result, null)).toBeNull();
    expect(operationMessage({ outcome: 'rejected', reference: null, error: { code: 'SESSION_FULL' } })).toBeNull();
  });
  test('unobserved is never represented as a final rejection or invented persistent pending status', () => {
    expect(readIntents(JSON.stringify({ actor, items: [{ ...intent, state: 'pending' }] }), actor)).toEqual([]);
    expect(new RequestError('NETWORK_UNCERTAIN').ambiguous).toBe(true);
    expect(new RequestError('SERVICE_UNAVAILABLE', 503).ambiguous).toBe(true);
    expect(new RequestError('SESSION_FULL', 409).ambiguous).toBe(false);
  });
  test('returnTo is an allowlist with role-aware fallback, never query/protocol-relative/backslash URLs', () => {
    expect(safeReturnTo(`/aluno/aulas/${sessionId}`)).toBe(`/aluno/aulas/${sessionId}`);
    expect(safeReturnTo('/admin/presencas', 'admin')).toBe('/admin/presencas'); expect(safeReturnTo('/admin', 'student')).toBe('/aluno');
    for (const value of ['//evil.example', '/\\evil', '/api/v1/auth/logout', '/aluno?next=evil', '/aluno/%2f%2fevil', 'https://evil.example', ['bad']]) expect(safeReturnTo(value)).toBe('/aluno');
  });
  test('calendar arithmetic crosses month/year boundaries and formats real zones', () => {
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01'); expect(weekStart('2026-11-01')).toBe('2026-10-26');
    expect(new Date(browserRange('2026-11-01').to).getTime()).toBeGreaterThan(new Date(browserRange('2026-11-01').from).getTime());
    expect(dateInZone('2026-10-31T01:00:00Z', 'America/Sao_Paulo')).toBe('2026-10-30');
  });
});
describe('browser BFF client', () => {
  test('uses same-origin, no-store, exact If-Match/idempotency key, and never bearer auth', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: reservation }), { status: 200 })); vi.stubGlobal('fetch', fetcher);
    expect(await api('me', { method: 'PATCH', body: { fullName: 'TEST' }, version: 3, key: intent.key, expectedActor: actor })).toEqual(reservation);
    const [path, init] = fetcher.mock.calls[0]; expect(path).toBe('/api/v1/me');
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin', headers: { 'If-Match': '"3"', 'Idempotency-Key': intent.key, 'X-Expected-Actor': actor } });
    expect(init.headers).not.toHaveProperty('Authorization');
  });
  test('preserves authoritative rejected operations from 409 responses', async () => {
    const operation: OperationResult = { outcome: 'rejected', reference: null, error: { code: 'BIKE_TAKEN' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'BIKE_TAKEN', operation } }), { status: 409 })));
    await expect(api('reservations', { method: 'POST', key: intent.key, body: { sessionId }, expectedActor: actor })).rejects.toMatchObject({ code: 'BIKE_TAKEN', operation, status: 409 });
  });
  test('transport and invalid envelopes remain ambiguous and do not fabricate success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline'))); await expect(api('reservations', { method: 'POST', expectedActor: actor })).rejects.toMatchObject({ ambiguous: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))); await expect(api('reservations')).rejects.toMatchObject({ ambiguous: true });
  });
  test('error strings are safe for users and contain no provider/SQL details', () => {
    expect(errorMessage(new RequestError('ENVIRONMENT_NOT_CONFIGURED', 503))).toContain('indisponível');
    expect(errorMessage(new RequestError('VERSION_CONFLICT', 409))).toContain('Recarregue');
  });
});
describe('HTML auth handoff regression', () => {
  test('handoff redirects only to fixed UI pages, never trusts next or claims authentication', async () => {
    for (const [status, location] of [['authenticated', '/aluno'], ['recovery_verified', '/redefinir-senha'], ['https://evil.example', '/entrar?result=invalid_link']]) {
      const response = handoff(new Request(`http://localhost/auth/result?status=${status}&next=//evil.example`));
      expect(response.status).toBe(303); expect(response.headers.get('location')).toBe(location); expect(response.headers.get('cache-control')).toContain('no-store');
    }
  });
  test('email scanners cannot consume confirmation proof: GET is a script-free explicit form', async () => {
    const response = confirmation(new Request('http://localhost/auth/confirm?token_hash=test-only-valid-token-hash&type=invite'));
    expect(response.status).toBe(200); const html = await response.text();
    expect(html).toContain('method="post"'); expect(html).toContain('Confirmar acesso'); expect(html).not.toContain('<script'); expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const bad = confirmation(new Request('http://localhost/auth/confirm?token_hash=<script>&type=invite'));
    expect(bad.status).toBe(422); expect(await bad.text()).not.toContain('<script>');
  });
});

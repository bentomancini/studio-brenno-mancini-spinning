import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ApiError } from './errors';
import { env } from './env';
import { uuid } from '@/contracts';

export function assertOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const allowed = env().APP_ORIGIN;
  if (origin) {
    if (origin !== allowed || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'CSRF_REJECTED');
    return;
  }
  const referer = request.headers.get('referer');
  if (referer && referer.startsWith(`${allowed}/`) && request.headers.get('sec-fetch-site') !== 'cross-site') {
    return;
  }
  throw new ApiError(403, 'CSRF_REJECTED');
}
export function expectedActor(request: Request, actualActor: string): string {
  // This is an intent binding, never identity or permission. Actual actor is server-validated.
  const parsed = uuid.safeParse(request.headers.get('X-Expected-Actor'));
  if (!parsed.success) throw new ApiError(422, 'EXPECTED_ACTOR_REQUIRED');
  const expected = parsed.data.toLowerCase();
  if (expected !== actualActor.toLowerCase()) throw new ApiError(409, 'ACTOR_CHANGED');
  return expected;
}
export function privateHeaders(requestId: string) {
  return { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Origin', 'X-Request-Id': requestId };
}
export async function endpoint(request: Request, action: () => Promise<unknown>, status = 200) {
  const requestId = randomUUID();
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) assertOrigin(request);
    const data = await action();
    const response = NextResponse.json({ data, requestId }, { status, headers: privateHeaders(requestId) });
    if (data && typeof data === 'object' && 'version' in data && typeof data.version === 'number') response.headers.set('ETag', `"${data.version}"`);
    return response;
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : cause instanceof z.ZodError ? new ApiError(422, 'VALIDATION_ERROR', z.flattenError(cause).fieldErrors as Record<string, string[]>) : new ApiError(503, 'SERVICE_UNAVAILABLE');
    // No bodies, SQL, cookies, tokens, e-mails or provider error strings in logs.
    if (error.status >= 500) console.error(JSON.stringify({ requestId, code: error.code }));
    return NextResponse.json({ error: { code: error.code, requestId, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}), ...(error.operation ? { operation: error.operation } : {}) } }, {
      status: error.status, headers: { ...privateHeaders(requestId), ...(error.status === 429 ? { 'Retry-After': '60' } : {}) },
    });
  }
}
export async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'JSON_REQUIRED');
  const text = await limitedText(request, 262144);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ApiError(422, 'INVALID_JSON'); }
  return schema.parse(parsed);
}
export async function limitedText(request: Request, maxBytes: number) {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new ApiError(413, 'BODY_TOO_LARGE');
  // Enforce the limit while streaming as Content-Length is optional/untrusted.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, 'BODY_TOO_LARGE'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function version(request: Request): number {
  const raw = request.headers.get('if-match');
  if (!raw) throw new ApiError(428, 'IF_MATCH_REQUIRED');
  if (!/^"[1-9][0-9]{0,14}"$/.test(raw)) throw new ApiError(422, 'INVALID_IF_MATCH');
  return Number(raw.slice(1, -1));
}
export function internalReturnTo(value: string | null | undefined): string {
  if (!value) return '/auth/result';
  // Explicit allowlist, never a protocol-relative URL, query or arbitrary internal endpoint.
  if (!/^\/(aluno\/(agenda|reservas|historico|perfil)|admin\/(alunos|instrutores|agenda|bicicletas|reservas|presencas))$/.test(value)) throw new ApiError(422, 'INVALID_RETURN_TO');
  return value;
}

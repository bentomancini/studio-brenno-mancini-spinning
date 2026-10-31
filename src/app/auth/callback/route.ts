import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { serverClient, clearAuthCookies } from '@/lib/server/supabase';
import { env } from '@/lib/server/env';
import { privateHeaders } from '@/lib/server/http';
import { establish, grantRecovery } from '@/modules/identity/service';
import { ApiError } from '@/lib/server/errors';
import { authDocument } from '@/lib/server/auth-document';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const requestId = randomUUID();
  let config: ReturnType<typeof env>;
  try { config = env(); } catch {
    return authDocument(requestId, 'Acesso indisponível', 'Não foi possível validar este link agora. Solicite um novo link e tente novamente em instantes.', 503);
  }
  const url = new URL(request.url);
  const scope = url.searchParams.get('flow') === 'recovery' ? 'recovery' : 'normal';
  let status = 'invalid_link';
  try {
    const code = url.searchParams.get('code');
    if (!code || code.length > 2048 || url.searchParams.has('error') || (url.searchParams.has('flow') && scope !== 'recovery')) throw new ApiError(401, 'CONFIRMATION_INVALID');
    const client = await serverClient(scope);
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      if (!error.status || error.status >= 500 || error.status === 429) throw new ApiError(503, 'AUTH_CALLBACK_UNAVAILABLE');
      throw new ApiError(401, 'CONFIRMATION_INVALID');
    }
    if (scope === 'recovery') { await grantRecovery(client); status = 'recovery_verified'; }
    else { await establish(client); status = 'authenticated'; }
  } catch (error) {
    await clearAuthCookies(scope);
    if (!(error instanceof ApiError) || error.status >= 500) return authDocument(requestId, 'Não foi possível validar o link', 'O serviço está indisponível. Solicite um novo link antes de tentar novamente.', 503);
  }
  // No attacker-controlled return URL and no token forwarded in redirect/JSON.
  return NextResponse.redirect(`${config.APP_ORIGIN}/auth/result?status=${status}`, { status: 303, headers: privateHeaders(requestId) });
}

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { confirmation } from '@/contracts';
import { endpoint, assertOrigin, privateHeaders, limitedText } from '@/lib/server/http';
import { serverClient, clearAuthCookies } from '@/lib/server/supabase';
import { ApiError } from '@/lib/server/errors';
import { authRateLimit, establish, grantRecovery } from '@/modules/identity/service';
import { authDocument } from '@/lib/server/auth-document';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = confirmation.safeParse({ tokenHash: params.get('token_hash'), type: params.get('type') });
  const requestId = randomUUID();
  if (!parsed.success) return authDocument(requestId, 'Link inválido', 'Este link é inválido ou está incompleto. Solicite um novo link.', 422);
  // Input is restricted to an HTML-safe alphabet. GET does NOT consume email tokens.
  return authDocument(requestId, 'Confirme seu acesso', 'Continue para validar o link recebido por e-mail. A abertura desta página não confirma sua conta.', 200, `<form method="post" action="/auth/confirm"><input type="hidden" name="tokenHash" value="${parsed.data.tokenHash}"><input type="hidden" name="type" value="${parsed.data.type}"><button type="submit">Confirmar acesso</button></form>`);
}
export async function POST(request: Request) {
  let recovery = false;
  const response = await endpoint(request, async () => {
    assertOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new ApiError(415, 'FORM_REQUIRED');
    const text = await limitedText(request, 4096);
    const form = new URLSearchParams(text);
    const input = confirmation.parse(Object.fromEntries(form));
    recovery = input.type === 'recovery';
    await authRateLimit(request, 'confirm');
    const scope = input.type === 'recovery' ? 'recovery' : 'normal'; const client = await serverClient(scope);
    const { error } = await client.auth.verifyOtp({ token_hash: input.tokenHash, type: input.type });
    if (error) {
      console.error('[auth/confirm] verifyOtp failed');
      await clearAuthCookies(scope);
      throw new ApiError(401, 'CONFIRMATION_INVALID');
    }
    if (scope === 'recovery') {
      try {
        await grantRecovery(client);
      } catch (error) {
        console.error('[auth/confirm] grantRecovery failed');
        throw error;
      }
      return { recoveryVerified: true, nextAction: 'POST /api/v1/auth/reset-password' };
    }
    return establish(client);
  });
  if (response.ok) {
    const res = new NextResponse(null, { status: 303, headers: { ...privateHeaders(randomUUID()), Location: `/auth/result?status=${recovery ? 'recovery_verified' : 'authenticated'}` } });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) res.headers.append('Set-Cookie', sc);
    return res;
  }
  return authDocument(randomUUID(), response.status >= 500 ? 'Validação indisponível' : 'Não foi possível confirmar o acesso', response.status >= 500 ? 'Não foi possível validar este link agora. Solicite um novo link antes de tentar novamente.' : 'Este link não pôde ser validado. Ele pode ter expirado ou já ter sido utilizado. Solicite um novo link.', response.status);
}

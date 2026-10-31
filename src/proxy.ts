import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { env } from '@/lib/server/env';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  try {
    const config = env();
    const client = createServerClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
      cookieOptions: { name: 'studio-auth', httpOnly: true, secure: config.APP_ENV === 'production', sameSite: 'lax', path: '/' },
      cookies: { getAll: () => request.cookies.getAll(), setAll(values) {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) response.cookies.set(name, value, { ...options, httpOnly: true, secure: config.APP_ENV === 'production', sameSite: 'lax', path: '/' });
      } },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: init?.signal ?? AbortSignal.timeout(15000) }) },
    });
    await client.auth.getUser();
  } catch { /* The page guard renders an honest unavailable state; never grants access here. */ }
  response.headers.set('Cache-Control', 'private, no-store, max-age=0'); response.headers.set('Pragma', 'no-cache'); response.headers.append('Vary', 'Cookie');
  return response;
}
export const config = { matcher: ['/aluno/:path*', '/admin/:path*'] };

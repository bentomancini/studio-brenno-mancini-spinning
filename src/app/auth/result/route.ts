import { NextResponse } from 'next/server';
import { privateHeaders } from '@/lib/server/http';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  const status = new URL(request.url).searchParams.get('status');
  const location = status === 'recovery_verified' ? '/redefinir-senha' : status === 'authenticated' ? '/aluno' : '/entrar?result=invalid_link';
  // Fixed local paths only. Query flags never authorize anything; destination
  // pages / BFF still validate the identity or one-use recovery grant.
  return new NextResponse(null, { status: 303, headers: { ...privateHeaders(randomUUID()), Location: location } });
}

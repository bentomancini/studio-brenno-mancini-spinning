import 'server-only';
import { NextResponse } from 'next/server';
import { privateHeaders } from './http';

// Static, script-free callback UI. The only dynamic HTML fragment is the
// alphabet-restricted token-hash form constructed by /auth/confirm.
export function authDocument(requestId: string, title: string, text: string, status = 200, form = '') {
  return new NextResponse(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>${title} | Studio Brenno Mancini</title><link rel="icon" href="/icon.svg" type="image/svg+xml"><style>body{margin:0;background:#f5f3ee;color:#171a18;font:16px/1.5 system-ui,sans-serif}main{max-width:440px;margin:12vh auto;padding:24px}h1{font-size:28px;line-height:1.2}button,a{min-height:48px;display:inline-flex;align-items:center;padding:8px 20px;border-radius:6px;font:inherit}button{background:#ad371c;color:white;border:0;cursor:pointer}a{color:#ad371c;padding-left:0}a:focus-visible,button:focus-visible{outline:3px solid #ad371c;outline-offset:4px}input{font:inherit}</style></head><body><main id="conteudo"><p>Studio Brenno Mancini Spinning</p><h1>${title}</h1><p>${text}</p>${form}<p><a href="/entrar">Ir para entrar</a> <a href="/recuperar-senha">Solicitar novo link</a></p></main></body></html>`, { status, headers: { ...privateHeaders(requestId), 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } });
}

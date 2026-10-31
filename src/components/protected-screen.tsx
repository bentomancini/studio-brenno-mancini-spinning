import type { ReactNode } from 'react';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import { pageIdentity } from '@/lib/server/page-auth';
import { ApiError } from '@/lib/server/errors';
import { StudioShell } from './shell';
import { Brand } from './ui';
import styles from './studio.module.css';

export async function ProtectedScreen({ path, admin = false, children }: { path: string; admin?: boolean; children: ReactNode }) {
  let identity;
  try { identity = await pageIdentity(admin, path); }
  catch (error) {
    unstable_rethrow(error);
    const forbidden = error instanceof ApiError && error.status === 403;
    return <main id="conteudo" tabIndex={-1} className={styles.statusPage}><Brand /><h1>{forbidden ? 'Acesso não permitido' : 'O Studio está indisponível no momento'}</h1><p>{forbidden ? 'Esta área exige uma conta administrativa ativa. O conteúdo protegido não foi carregado.' : 'Não foi possível consultar sua sessão com segurança. Nenhuma reserva foi enviada. Tente novamente em instantes.'}</p><div className="actions"><a className="button" href={path}>Tentar novamente</a><Link className="button secondary" href={forbidden ? '/aluno' : '/entrar'}>{forbidden ? 'Área do aluno' : 'Ir para entrar'}</Link><Link href="/">Início do site</Link></div></main>;
  }
  return <StudioShell identity={identity} admin={admin}>{children}</StudioShell>;
}

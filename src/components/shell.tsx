'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionIdentity } from '@/contracts';
import { api } from '@/lib/ui/api';
import { loginHref } from '@/lib/ui/navigation';
import { Brand, Button, ErrorState, Icon, Modal, type IconName } from './ui';
import { clearIntents, OperationsProvider } from './operations';
import styles from './studio.module.css';
import { PrivateActorProvider } from './private-actor';

const studentLinks: [string, string, IconName][] = [['/aluno', 'Início', 'home'], ['/aluno/agenda', 'Agenda', 'calendar'], ['/aluno/reservas', 'Reservas', 'ticket'], ['/aluno/perfil', 'Perfil', 'user']];
export const adminLinks = [['/admin', 'Visão geral'], ['/admin/agenda', 'Agenda'], ['/admin/reservas', 'Reservas'], ['/admin/presencas', 'Presenças'], ['/admin/alunos', 'Alunos'], ['/admin/instrutores', 'Instrutores'], ['/admin/bicicletas', 'Bicicletas'], ['/admin/configuracoes', 'Políticas']];
export function StudioShell({ identity, admin = false, children }: { identity: SessionIdentity; admin?: boolean; children: ReactNode }) {
  return <PrivateActorProvider key={`${identity.userId}:${identity.role}`} identity={identity}><ShellContents identity={identity} admin={admin}>{children}</ShellContents></PrivateActorProvider>;
}
function ShellContents({ identity, admin = false, children }: { identity: SessionIdentity; admin?: boolean; children: ReactNode }) {
  const path = usePathname(); const previous = useRef(path); const [drawer, setDrawer] = useState(false); const [online, setOnline] = useState(true);
  const [logout, setLogout] = useState(false); const [loggingOut, setLoggingOut] = useState(false); const [error, setError] = useState<unknown>();
  const active = (href: string) => path === href || href === '/aluno/reservas' && path === '/aluno/historico' || href.endsWith('/agenda') && path.includes('/aulas/');
  useEffect(() => {
    if (previous.current !== path) { document.getElementById('conteudo')?.focus(); previous.current = path; }
    const connectivity = () => setOnline(navigator.onLine); connectivity();
    const keyboard = () => { const viewport = window.visualViewport; document.documentElement.dataset.studioKeyboard = viewport && viewport.height < Math.min(500, window.innerHeight * .7) ? 'open' : 'closed'; }; keyboard();
    const expired = () => window.location.assign(loginHref(path));
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity); window.addEventListener('studio:expired', expired); window.visualViewport?.addEventListener('resize', keyboard);
    return () => { window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity); window.removeEventListener('studio:expired', expired); window.visualViewport?.removeEventListener('resize', keyboard); delete document.documentElement.dataset.studioKeyboard; };
  }, [identity.userId, identity.role, path]);
  async function signOut() { setLoggingOut(true); setError(undefined); try { await api('auth/logout', { method: 'POST', body: {} }); clearIntents(); window.location.replace('/entrar'); } catch (error) { setError(error); setLoggingOut(false); } }
  const navLinks = <>{adminLinks.map(([href, label], index) => <span key={href}>{index === 1 && <span className={styles.navGroup}>Operação</span>}{index === 4 && <span className={styles.navGroup}>Cadastros</span>}{index === 7 && <span className={styles.navGroup}>Studio</span>}<Link href={href} aria-current={active(href) ? 'page' : undefined} onClick={() => setDrawer(false)}>{label}</Link></span>)}</>;
  const content = <>{!online && <div className={styles.offline} role="status">Você está sem conexão. Os dados podem estar desatualizados. Reservas não são enviadas em modo offline.</div>}<main id="conteudo" tabIndex={-1} className={admin ? styles.adminMain : styles.studentMain}><OperationsProvider identity={identity}>{children}</OperationsProvider></main></>;
  return <>{admin ? <div className={styles.adminShell}><aside className={styles.sidebar}><Brand /><nav aria-label="Administração" className={styles.adminNav}>{navLinks}</nav><div className={styles.sidebarFoot}><Link href="/aluno">Área do aluno</Link><Button className="quiet" onClick={() => setLogout(true)}><Icon name="logout" />Sair</Button></div></aside><div className={styles.adminContent}><header className={styles.adminBar}><button className="icon-button" onClick={() => setDrawer(true)} aria-label="Abrir navegação administrativa"><Icon name="menu" /></button><span>Administração do Studio</span><Link href="/aluno">Área do aluno</Link></header>{content}</div></div> : <><header className={styles.appHeader}><div className={styles.appHeaderInner}><Brand /><nav className={styles.studentNav} aria-label="Área do aluno">{studentLinks.map(([href, label, icon]) => <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined}><Icon name={icon} />{label}</Link>)}</nav>{identity.role === 'admin' && <Link href="/admin" className="button quiet">Admin</Link>}</div></header>{content}</>}
    {drawer && <Modal title="Navegação" drawer onClose={() => setDrawer(false)}><nav className={styles.drawerNav} aria-label="Administração mobile">{navLinks}</nav><Button className="quiet" onClick={() => { setDrawer(false); setLogout(true); }}><Icon name="logout" />Sair</Button></Modal>}
    {logout && <Modal title="Sair da sua conta?" onClose={() => setLogout(false)} busy={loggingOut}><p>Intenções não verificadas ficam disponíveis apenas até sair. Confira suas reservas antes de encerrar a sessão se houver alguma dúvida.</p>{error !== undefined && <ErrorState error={error} />}<div className="actions"><Button busy={loggingOut} onClick={signOut}>Sair da conta</Button><Button className="secondary" disabled={loggingOut} onClick={() => setLogout(false)}>Continuar aqui</Button></div></Modal>}
  </>;
}

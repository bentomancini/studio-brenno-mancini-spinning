'use client';
import Link from 'next/link';
import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { PrivateActorContext } from '@/lib/ui/actor-context';
import { errorMessage } from '@/lib/ui/api';
import { statusLabels } from '@/lib/ui/format';

export type IconName = 'arrow' | 'calendar' | 'home' | 'ticket' | 'user' | 'menu' | 'close' | 'check' | 'alert' | 'chevron-left' | 'chevron-right' | 'logout' | 'bike' | 'clock' | 'refresh';
const paths: Record<IconName, ReactNode> = {
  arrow: <><path d="M4 12h16M14 6l6 6-6 6" /></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" /></>,
  home: <><path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z" /></>, ticket: <><path d="M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM15 7v3m0 4v5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" /></>, menu: <path d="M4 6h16M4 12h16M4 18h16" />, close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />, alert: <><path d="m12 3 10 18H2zM12 9v5M12 17v1" /></>, 'chevron-left': <path d="m15 5-7 7 7 7" />, 'chevron-right': <path d="m9 5 7 7-7 7" />,
  logout: <><path d="M10 4H4v16h6M10 12h11m-5-5 5 5-5 5" /></>, bike: <><circle cx="5" cy="17" r="4" /><circle cx="19" cy="17" r="4" /><path d="m5 17 5-10 5 10H5m5-10h6l3 10M8 4h4m3 0h3v3" /></>, clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" /></>, refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></>,
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) { return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>; }
export function Brand({ inverse = false }: { inverse?: boolean }) { return <Link href="/" className={`brand${inverse ? ' inverse' : ''}`} aria-label="Studio Brenno Mancini Spinning, início"><span>Studio Brenno Mancini</span><span className="brand-sub">Spinning</span></Link>; }
const publicStatus = () => 'verified' as const;
const checkingStatus = () => 'checking' as const;
const noSubscription = () => () => {};
export function Button({ busy, actorExempt = false, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; actorExempt?: boolean }) {
  const actor = useContext(PrivateActorContext);
  const status = useSyncExternalStore(actor?.subscribe ?? noSubscription, actor?.getStatus ?? publicStatus, actor ? checkingStatus : publicStatus);
  return <button {...props} disabled={props.disabled || busy || (!actorExempt && !!actor && status !== 'verified')} className={`button ${className}`} aria-busy={busy || undefined}>{busy && <span className="spinner" aria-hidden="true" />}{children}</button>;
}
export function Notice({ children, tone = 'info', alert = false }: { children: ReactNode; tone?: 'info' | 'success' | 'danger' | 'warning'; alert?: boolean }) { return <div className={`notice ${tone}`} role={alert ? 'alert' : 'status'}><Icon name={tone === 'success' ? 'check' : 'alert'} /><div>{children}</div></div>; }
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) { return <div className="error-state"><Notice tone="danger" alert>{errorMessage(error)}</Notice>{retry && <Button className="secondary" onClick={retry}><Icon name="refresh" />Tentar novamente</Button>}</div>; }
export function Empty({ title, children, href, action }: { title: string; children?: ReactNode; href?: string; action?: string }) { return <div className="empty"><Icon name="calendar" size={28} /><h2>{title}</h2>{children && <p>{children}</p>}{href && <Link href={href} className="button secondary">{action ?? 'Ver agenda'}<Icon name="arrow" /></Link>}</div>; }
export function Loading({ label = 'Carregando dados…' }: { label?: string }) { return <div className="loading" role="status"><span className="spinner" />{label}</div>; }
export function Badge({ status }: { status: string }) { return <span className={`badge ${['confirmed', 'present', 'published'].includes(status) ? 'positive' : ['cancelled', 'absent'].includes(status) ? 'negative' : ''}`}><span aria-hidden="true">{['confirmed', 'present'].includes(status) ? '✓' : '•'}</span>{statusLabels[status] ?? status}</span>; }
export function Field({ label, hint, error, id: suppliedId, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const autoId = useId(); const id = suppliedId ?? autoId;
  return <div className="field"><label htmlFor={id}>{label}</label><input {...props} id={id} aria-invalid={!!error || undefined} aria-describedby={error || hint ? `${id}-help` : undefined} />{(error || hint) && <p id={`${id}-help`} className={error ? 'field-error' : 'hint'}>{error ?? hint}</p>}</div>;
}
export function Password({ label = 'Senha', error, hint, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: string; error?: string; hint?: string }) {
  const id = useId(); const [visible, setVisible] = useState(false);
  return <div className="field"><label htmlFor={id}>{label}</label><div className="password"><input {...props} id={id} type={visible ? 'text' : 'password'} aria-invalid={!!error || undefined} aria-describedby={hint || error ? `${id}-help` : undefined} /><button type="button" onClick={() => setVisible(!visible)} aria-controls={id} aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${label.toLowerCase()}`} aria-pressed={visible}>{visible ? 'Ocultar' : 'Mostrar'}</button></div>{(hint || error) && <p id={`${id}-help`} className={error ? 'field-error' : 'hint'}>{error ?? hint}</p>}</div>;
}
export function Modal({ title, children, onClose, busy = false, drawer = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`modal${drawer ? ' drawer' : ''}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}><div className="modal-head"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Fechar"><Icon name="close" /></button></div>{children}</dialog>;
}
export function Pager({ offset, count, limit, onChange }: { offset: number; count: number; limit: number; onChange: (value: number) => void }) { return <nav className="pager" aria-label="Paginação"><Button className="secondary" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}><Icon name="chevron-left" />Anterior</Button><span>Página {Math.floor(offset / limit) + 1}</span><Button className="secondary" disabled={count < limit} onClick={() => onChange(offset + limit)}>Próxima<Icon name="chevron-right" /></Button></nav>; }
export function PageHeading({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { return <header className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children}</header>; }
export function focusInvalid(form: HTMLFormElement) { requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); }

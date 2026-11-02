'use client';
import { useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { SessionIdentity } from '@/contracts';
import { createPrivateApi, type ActorStatus } from '@/lib/ui/private-api';
import { PrivateActorContext as Context } from '@/lib/ui/actor-context';
import { loginHref } from '@/lib/ui/navigation';
import { Button, Notice } from './ui';

export function usePrivateApi() { const value = useContext(Context); if (!value) throw new Error('Private actions require the server actor context'); return value; }
const serverStatus = (): ActorStatus => 'checking';
export function useActorStatus() { const actor = usePrivateApi(); return useSyncExternalStore(actor.subscribe, actor.getStatus, serverStatus); }

export function PrivateActorProvider({ identity, children }: { identity: SessionIdentity; children: ReactNode }) {
  // StudioShell keys this provider by actor/role: a new actor remounts drafts,
  // rather than replacing the expected identity underneath an old form.
  const [actor] = useState(() => createPrivateApi(identity)); const path = usePathname();
  const status = useSyncExternalStore(actor.subscribe, actor.getStatus, serverStatus);
  useEffect(() => {
    actor.start();
    const verify = () => { if (document.visibilityState === 'visible' && navigator.onLine) void actor.verify(); else actor.pause(); };
    const visibility = () => { if (document.visibilityState === 'visible') verify(); else actor.pause(); };
    window.addEventListener('focus', verify); window.addEventListener('blur', actor.pause); window.addEventListener('online', verify); window.addEventListener('offline', actor.pause); document.addEventListener('visibilitychange', visibility);
    verify();
    return () => { actor.dispose(); window.removeEventListener('focus', verify); window.removeEventListener('blur', actor.pause); window.removeEventListener('online', verify); window.removeEventListener('offline', actor.pause); document.removeEventListener('visibilitychange', visibility); };
  }, [actor]);
  return <Context.Provider value={actor}>
    {status !== 'verified' && status !== 'checking' && <section aria-label="Verificação da conta" style={{ padding: '12px 16px' }}>
      <Notice tone={status === 'changed' ? 'warning' : 'danger'}>
        {status === 'changed' ? 'A conta mudou em outra aba. As ações deste contexto foram interrompidas; nenhuma intenção será repetida automaticamente.' : 'Não foi possível verificar a conta desta página. Consulte os dados, mas verifique a conta antes de enviar ações.'}
        {status === 'unverified' && <Button actorExempt className="secondary" onClick={() => void actor.verify()}>Verificar conta novamente</Button>}
        {status === 'changed' && <div className="actions"><a className="button secondary" href={loginHref(path)}>Entrar novamente</a><a className="button secondary" href={path}>Atualizar contexto</a></div>}
      </Notice>
    </section>}
    {/* Buttons inherit the gate, including native-dialog submit actions. Draft
        fields, dialog close, links and read navigation stay usable. The bound
        request also rejects Enter/programmatic submits before React paints. */}
    {children}
  </Context.Provider>;
}

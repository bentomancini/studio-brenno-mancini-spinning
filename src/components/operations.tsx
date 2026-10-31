'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { OperationObservation, OperationResult, SessionIdentity } from '@/contracts';
import { errorMessage, RequestError } from '@/lib/ui/api';
import { INTENT_STORAGE, intentRequest, operationMessage, type Intent } from '@/lib/ui/intent';
import { closeIntentScope, invalidateIntentScopes, loadScopedIntents, openIntentScope, ownsIntentScope, updateScopedIntents, type IntentScope } from '@/lib/ui/intent-store';
import { revalidateStudio } from '@/lib/ui/hooks';
import { Button, Notice } from './ui';
import { useActorStatus, usePrivateApi } from './private-actor';

type OperationContext = { intents: Intent[]; busy: string | null; ready: boolean; run: (input: Omit<Intent, 'key'>) => Promise<void> };
const Context = createContext<OperationContext | null>(null);
export function useOperations() { const value = useContext(Context); if (!value) throw new Error('Operations must be inside StudioShell'); return value; }
export function clearIntents() { invalidateIntentScopes(); try { sessionStorage.removeItem(INTENT_STORAGE); } catch { /* Retired callbacks cannot recreate storage after logout. */ } }

export function OperationsProvider({ identity, children }: { identity: SessionIdentity; children: ReactNode }) {
  const privateApi = usePrivateApi(); const actorStatus = useActorStatus();
  const [intents, setIntents] = useState<Intent[]>([]); const scope = useRef<IntentScope | null>(null);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState<string | null>(null); const active = useRef(false);
  const [notice, setNotice] = useState<{ message: string; danger?: boolean; informational?: boolean } | null>(null);
  useEffect(() => {
    const lease = openIntentScope(identity.userId); scope.current = lease; active.current = false;
    setBusy(null); setNotice(null); setReady(false); setIntents([]);
    try { setIntents(loadScopedIntents(sessionStorage, lease)); setReady(true); }
    catch { setNotice({ message: 'O armazenamento desta aba não está disponível. Não será possível enviar reservas com recuperação segura.', danger: true }); }
    return () => { closeIntentScope(lease); if (scope.current === lease) scope.current = null; };
  }, [identity.userId]);
  const persist = useCallback((lease: IntentScope, update: (items: Intent[]) => Intent[]) => {
    if (scope.current !== lease || !ownsIntentScope(lease)) return null;
    const items = updateScopedIntents(sessionStorage, lease, update);
    if (items && scope.current === lease && ownsIntentScope(lease)) setIntents(items);
    return items;
  }, []);
  const resolve = useCallback((lease: IntentScope, intent: Intent, result: OperationResult, observation?: OperationObservation) => {
    if (persist(lease, items => items.filter(item => item.key !== intent.key)) === null) return;
    setNotice(result.outcome === 'rejected' ? { message: errorMessage(new RequestError(result.error?.code ?? 'OPERATION_REJECTED', 409)), danger: true } : { message: operationMessage(result, observation?.state === 'observed' ? observation.currentResource : undefined)! });
    revalidateStudio();
  }, [persist]);
  const send = useCallback(async (intent: Intent, lease = scope.current) => {
    if (!lease || lease.actor !== privateApi.actor || privateApi.getStatus() !== 'verified' || !ownsIntentScope(lease) || scope.current !== lease || active.current) return;
    active.current = true; setBusy(intent.key); setNotice(null);
    try { const { path, body } = intentRequest(intent); const result = await privateApi.request<OperationResult>(path, { method: 'POST', body, key: intent.key }); resolve(lease, intent, result); }
    catch (error) {
      if (scope.current !== lease || !ownsIntentScope(lease)) return;
      if (error instanceof RequestError && ['ACTOR_CHANGED', 'ACTOR_UNVERIFIED'].includes(error.code)) { setNotice({ message: errorMessage(error), danger: true }); return; }
      if (error instanceof RequestError && error.operation) resolve(lease, intent, error.operation);
      else if (error instanceof RequestError && !error.ambiguous && error.status !== 401 && error.code !== 'IDEMPOTENCY_CONFLICT') { if (persist(lease, items => items.filter(item => item.key !== intent.key)) === null) return; setNotice({ message: errorMessage(error), danger: true }); revalidateStudio(); }
      else setNotice({ message: 'Ainda não sabemos se a operação foi concluída. Verifique a situação antes de tentar outra reserva para esta aula.', danger: true });
    } finally { if (scope.current === lease && ownsIntentScope(lease)) { active.current = false; setBusy(null); } }
  }, [persist, resolve, privateApi]);
  const run = useCallback(async (input: Omit<Intent, 'key'>) => {
    const lease = scope.current;
    if (!lease || lease.actor !== privateApi.actor || privateApi.getStatus() !== 'verified' || !ownsIntentScope(lease) || active.current || !ready) return;
    if (!navigator.onLine) { setNotice({ message: 'Você está sem conexão. Nenhuma nova reserva foi enviada. Reconecte-se para consultar os dados atuais.', danger: true }); return; }
    const intent: Intent = { ...input, key: crypto.randomUUID() };
    try { const items = persist(lease, items => items.some(item => item.sessionId === input.sessionId) ? items : [...items, intent]); if (!items?.some(item => item.key === intent.key)) return; }
    catch { setNotice({ message: 'O navegador não permitiu guardar a intenção com segurança. Habilite o armazenamento desta aba antes de reservar.', danger: true }); return; }
    await send(intent, lease);
  }, [persist, ready, send, privateApi]);
  async function check(intent: Intent) {
    const lease = scope.current;
    if (!lease || lease.actor !== privateApi.actor || privateApi.getStatus() !== 'verified' || !ownsIntentScope(lease) || active.current) return;
    active.current = true; setBusy(intent.key);
    try { const observation = await privateApi.request<OperationObservation>(`me/operations/${intent.key}`); if (scope.current !== lease || !ownsIntentScope(lease)) return; if (observation.state === 'observed') resolve(lease, intent, observation.operation, observation); else setNotice({ message: 'A operação ainda não foi observada. Isso não significa que falhou. Verifique novamente ou repita exatamente a mesma intenção com o botão abaixo.', informational: true }); }
    catch (error) { if (scope.current === lease && ownsIntentScope(lease)) setNotice({ message: errorMessage(error), danger: true }); }
    finally { if (scope.current === lease && ownsIntentScope(lease)) { active.current = false; setBusy(null); } }
  }
  return <Context.Provider value={{ intents, busy, ready: ready && actorStatus === 'verified', run }}>
    <div className="operation-feedback">
      {notice && <Notice tone={notice.danger ? 'warning' : notice.informational ? 'info' : 'success'}>
        {notice.message}<button className="text-button" onClick={() => setNotice(null)}>Dispensar mensagem</button>
      </Notice>}
      {intents.map(intent => <section key={intent.key} className="unresolved" aria-label="Operação a verificar">
        <h2>{busy === intent.key ? 'Consultando sua solicitação…' : `Verifique sua ${intent.action.endsWith('cancel') ? 'solicitação de cancelamento' : 'reserva'}`}</h2>
        <p>{busy === intent.key ? 'Aguardando a resposta do servidor. Não repita a operação.' : 'Ainda não sabemos se a operação foi concluída. Apenas as ações desta aula ficam pausadas.'}</p>
        <p className="hint">Aula: <code>{intent.sessionId}</code></p>
        <div className="actions">
          <Button className="secondary" busy={busy === intent.key} disabled={!!busy || actorStatus !== 'verified'} onClick={() => check(intent)}>Verificar situação</Button>
          <Button className="quiet" disabled={!!busy || actorStatus !== 'verified'} onClick={() => send(intent)}>Repetir mesma intenção</Button>
        </div>
      </section>)}
    </div>{children}
  </Context.Provider>;
}

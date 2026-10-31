import type { SessionIdentity } from '@/contracts';
import { api, RequestError, type ApiOptions } from './api';
import { invalidateIntentScopes } from './intent-store';

export type ActorStatus = 'checking' | 'verified' | 'unverified' | 'changed';
type PrivateOptions = Omit<ApiOptions, 'expectedActor'>;

// One immutable actor per server-rendered context, never a mutable global actor.
// This is a UX gate, not authorization: the BFF/SQL must compare the header in
// the mutation transaction, including the window after a successful GET check.
export function createPrivateApi(identity: SessionIdentity, transport: typeof api = api) {
  const actor = identity.userId; const role = identity.role;
  let status: ActorStatus = 'checking'; let revision = 0; let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: ActorStatus) => { status = next; for (const listener of listeners) listener(); };
  const changed = () => {
    if (disposed) return;
    revision++; invalidateIntentScopes(actor); publish('changed');
  };
  const assertVerified = () => { if (disposed || status !== 'verified') throw new RequestError(status === 'changed' ? 'ACTOR_CHANGED' : 'ACTOR_UNVERIFIED', 409); };
  const pause = () => { if (!disposed && status !== 'changed') { revision++; publish('unverified'); } };
  async function verify() {
    if (disposed || status === 'changed') return;
    const attempt = ++revision; publish('checking');
    try {
      const actual = await transport<SessionIdentity>('session');
      if (disposed || attempt !== revision) return;
      if (actual.userId !== actor || actual.role !== role) changed(); else publish('verified');
    } catch { if (!disposed && attempt === revision) publish('unverified'); }
  }
  async function request<T>(path: string, options: PrivateOptions = {}): Promise<T> {
    assertVerified();
    try { return await transport<T>(path, { ...options, expectedActor: actor }); }
    catch (error) { if (error instanceof RequestError && error.code === 'ACTOR_CHANGED') changed(); throw error; }
  }
  return Object.freeze({ actor, request, verify, pause, changed, assertVerified,
    getStatus: () => status,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    // StrictMode may reconnect effects on the same React instance. No request
    // from an earlier effect generation can complete into the new generation.
    start: () => { disposed = false; revision++; publish('checking'); },
    dispose: () => { disposed = true; revision++; },
  });
}
export type PrivateApi = ReturnType<typeof createPrivateApi>;

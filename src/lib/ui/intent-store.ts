import { INTENT_STORAGE, intentEnvelope, type Intent } from './intent';

type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type IntentScope = Readonly<{ actor: string }>;
// One active UI instance per tab. No private DTOs or auth credentials live here.
// A new page/actor retires the previous lease, even if its fetch is still alive.
let owner: IntentScope | null = null;
export function openIntentScope(actor: string): IntentScope { owner = { actor }; return owner; }
export function ownsIntentScope(scope: IntentScope) { return owner === scope; }
export function closeIntentScope(scope: IntentScope) { if (ownsIntentScope(scope)) owner = null; }
export function invalidateIntentScopes(actor?: string) { if (actor === undefined || owner?.actor === actor) owner = null; }

export function loadScopedIntents(storage: StorageAccess, scope: IntentScope): Intent[] {
  if (!ownsIntentScope(scope)) return [];
  const raw = storage.getItem(INTENT_STORAGE);
  if (raw === null) return [];
  const envelope = intentEnvelope.parse(JSON.parse(raw));
  if (envelope.actor !== scope.actor) { storage.removeItem(INTENT_STORAGE); return []; }
  return envelope.items;
}

export function updateScopedIntents(storage: StorageAccess, scope: IntentScope, update: (current: Intent[]) => Intent[]): Intent[] | null {
  if (!ownsIntentScope(scope)) return null;
  const raw = storage.getItem(INTENT_STORAGE);
  const envelope = raw === null ? { actor: scope.actor, items: [] } : intentEnvelope.parse(JSON.parse(raw));
  // Foreign storage may only be cleared during an explicit actor activation,
  // never overwritten by an asynchronous completion from the old actor.
  if (envelope.actor !== scope.actor) return null;
  const next = intentEnvelope.parse({ actor: scope.actor, items: update(envelope.items) });
  if (!ownsIntentScope(scope)) return null;
  // Synchronous read/modify/write, with no await or stale component array.
  storage.setItem(INTENT_STORAGE, JSON.stringify(next));
  return next.items;
}

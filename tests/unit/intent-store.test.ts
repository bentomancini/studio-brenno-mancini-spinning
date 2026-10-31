import { afterEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INTENT_STORAGE, intentRequest, readIntents, type Intent } from '@/lib/ui/intent';
import { closeIntentScope, invalidateIntentScopes, loadScopedIntents, openIntentScope, ownsIntentScope, updateScopedIntents } from '@/lib/ui/intent-store';

function storageFixture() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const makeIntent = (): Intent => ({ action: 'reserve', key: randomUUID(), sessionId: randomUUID(), bikeId: randomUUID() });
afterEach(invalidateIntentScopes);
describe('intent scope lifecycle and current-storage updates', () => {
  test('late completion from retired page A cannot erase B or consume A before reconciliation', () => {
    const storage = storageFixture(); const actor = randomUUID(); const a = makeIntent(); const b = makeIntent();
    const pageA = openIntentScope(actor); updateScopedIntents(storage, pageA, items => [...items, a]);
    const pageB = openIntentScope(actor); expect(loadScopedIntents(storage, pageB)).toEqual([a]);
    updateScopedIntents(storage, pageB, items => [...items, b]);
    expect(updateScopedIntents(storage, pageA, items => items.filter(item => item.key !== a.key))).toBeNull();
    expect(readIntents(storage.getItem(INTENT_STORAGE), actor)).toEqual([a, b]);
    expect(intentRequest(readIntents(storage.getItem(INTENT_STORAGE), actor)[1])).toEqual(intentRequest(b));
  });
  test('active resolver removes only its key from current storage, not a stale local snapshot', () => {
    const storage = storageFixture(); const actor = randomUUID(); const scope = openIntentScope(actor); const a = makeIntent(); const b = makeIntent();
    updateScopedIntents(storage, scope, items => [...items, a]);
    // A newer intention arrives after the UI obtained its local [A] snapshot.
    storage.setItem(INTENT_STORAGE, JSON.stringify({ actor, items: [a, b] }));
    expect(updateScopedIntents(storage, scope, items => items.filter(item => item.key !== a.key))).toEqual([b]);
    expect(readIntents(storage.getItem(INTENT_STORAGE), actor)).toEqual([b]);
  });
  test('unmount cleanup of old instance cannot retire the newer page', () => {
    const actor = randomUUID(); const previous = openIntentScope(actor); const current = openIntentScope(actor);
    closeIntentScope(previous); expect(ownsIntentScope(current)).toBe(true); closeIntentScope(current); expect(ownsIntentScope(current)).toBe(false);
  });
  test('logout invalidates outstanding callbacks before storage is cleared and prevents resurrection', () => {
    const storage = storageFixture(); const actor = randomUUID(); const oldScope = openIntentScope(actor); const a = makeIntent();
    updateScopedIntents(storage, oldScope, () => [a]); invalidateIntentScopes(); storage.removeItem(INTENT_STORAGE);
    expect(updateScopedIntents(storage, oldScope, () => [a])).toBeNull(); expect(storage.getItem(INTENT_STORAGE)).toBeNull();
    const nextLogin = openIntentScope(actor); expect(loadScopedIntents(storage, nextLogin)).toEqual([]);
    expect(updateScopedIntents(storage, oldScope, () => [a])).toBeNull();
  });
  test('actor switch clears foreign intentions only at activation; old actor cannot replace the new envelope', () => {
    const storage = storageFixture(); const first = randomUUID(); const second = randomUUID(); const a = makeIntent(); const b = makeIntent();
    const oldScope = openIntentScope(first); updateScopedIntents(storage, oldScope, () => [a]);
    const current = openIntentScope(second); expect(loadScopedIntents(storage, current)).toEqual([]); updateScopedIntents(storage, current, () => [b]);
    expect(updateScopedIntents(storage, oldScope, () => [])).toBeNull(); expect(readIntents(storage.getItem(INTENT_STORAGE), second)).toEqual([b]);
  });
  test('an unexpected foreign actor envelope is never overwritten by a live completion', () => {
    const storage = storageFixture(); const current = openIntentScope(randomUUID()); const foreign = randomUUID(); const b = makeIntent();
    const raw = JSON.stringify({ actor: foreign, items: [b] }); storage.setItem(INTENT_STORAGE, raw);
    expect(updateScopedIntents(storage, current, () => [])).toBeNull(); expect(storage.getItem(INTENT_STORAGE)).toBe(raw);
  });
  test('conflicting intention is checked against current storage before appending, even if UI was stale', () => {
    const storage = storageFixture(); const actor = randomUUID(); const scope = openIntentScope(actor); const a = makeIntent(); const duplicate = { ...a, key: randomUUID() };
    updateScopedIntents(storage, scope, () => [a]);
    expect(updateScopedIntents(storage, scope, items => items.some(item => item.sessionId === duplicate.sessionId) ? items : [...items, duplicate])).toEqual([a]);
  });
});

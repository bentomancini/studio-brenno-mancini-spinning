// Focused QA regressions. Same isolated controlled Auth HTTP + original native
// PostgreSQL harness as product.spec.ts, with no fixture/mocking in app runtime.
import { test, expect, type Page } from '@playwright/test';
import { intentRequest, type Intent } from '../../src/lib/ui/intent';

let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => { pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message)); });
test.afterEach(() => expect(pageErrors).toEqual([]));
async function login(page: Page, role: 'student' | 'admin') {
  await page.goto('/entrar'); await page.getByLabel('E-mail', { exact: true }).fill(`${role}-ui@example.invalid`); await page.getByLabel('Senha', { exact: true }).fill('test-browser-password-123'); await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await expect(page).toHaveURL(role === 'admin' ? /\/admin$/ : /\/aluno$/);
}
const origin = 'http://127.0.0.1:3210';
async function storageIntents(page: Page): Promise<Intent[]> { return page.evaluate(() => JSON.parse(sessionStorage.getItem('studio:intents:v1') ?? '{"items":[]}').items); }

test('QA1: late A response after SPA navigation cannot erase uncertain B; reload and retries retain exact key/body', async ({ page, browser, request }) => {
  test.setTimeout(60000);
  const state = await (await request.get('http://127.0.0.1:3211/__test/state')).json();
  const admin = await browser.newPage();
  await login(admin, 'admin'); const adminActor = (await (await admin.request.get('/api/v1/session')).json()).data.userId;
  const makeSession = async (name: string, days: number, bikeId: string) => {
    const start = new Date(state.startsAt); start.setUTCDate(start.getUTCDate() + days);
    const response = await admin.request.post('/api/v1/admin/sessions', { headers: { Origin: origin, 'X-Expected-Actor': adminActor }, data: { title: `TEST · QA ${name}`, instructorId: state.instructorId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 2700000).toISOString(), timezone: 'America/Sao_Paulo', capacity: 1, bikeMode: 'required', bikeIds: [bikeId], status: 'published' } });
    expect(response.status()).toBe(200); return (await response.json()).data;
  };
  const a = await makeSession('late A', 4, state.bikeIds[0]); const b = await makeSession('uncertain B', 5, state.bikeIds[1]); await admin.close();
  await login(page, 'student'); await page.goto(`/aluno/aulas/${a.id}`); await page.getByLabel('TEST-B01Disponível').check();
  let releaseA!: () => void; const delayedA = new Promise<void>(resolve => { releaseA = resolve; });
  let aCommitted!: () => void; const committedA = new Promise<void>(resolve => { aCommitted = resolve; });
  let aKey = ''; const bRequests: { key: string; body: unknown }[] = [];
  await page.route('**/api/v1/reservations', async route => {
    const req = route.request(); if (req.method() !== 'POST') return route.continue();
    const body = req.postDataJSON();
    if (body.sessionId === a.id) {
      aKey = req.headers()['idempotency-key']; const response = await route.fetch(); expect(response.status()).toBe(200); aCommitted(); await delayedA; await route.fulfill({ response }); return;
    }
    if (body.sessionId === b.id) { bRequests.push({ key: req.headers()['idempotency-key'], body }); if (bRequests.length === 1) return route.abort('failed'); }
    return route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click(); await committedA;
    // Only Next links here: a full document navigation would discard the old
    // JavaScript promise and would not exercise the retired-provider callback.
    await page.getByRole('navigation', { name: 'Área do aluno' }).getByRole('link', { name: 'Agenda', exact: true }).click();
    await page.getByLabel('Data de referência').fill(b.startsAt.slice(0, 10)); await page.getByRole('button', { name: 'Dia', exact: true }).click();
    await page.getByRole('article').filter({ hasText: b.title }).getByRole('link', { name: 'Ver aula', exact: true }).click(); await page.getByLabel('TEST-B02Disponível').check();
    await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click(); await expect(page.locator('.unresolved').filter({ hasText: b.id })).toBeVisible();
    expect(bRequests).toHaveLength(1); expect((await storageIntents(page)).map(item => item.key)).toEqual([aKey, bRequests[0].key]);
    const lateResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.request().headers()['idempotency-key'] === aKey);
    releaseA(); await (await lateResponse).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    // A is deliberately retained for GET reconciliation if its old callback
    // was ignored. B must remain byte-for-byte the same intention.
    const afterA = await storageIntents(page); expect(afterA.map(item => item.key)).toEqual([aKey, bRequests[0].key]); expect(intentRequest(afterA[1]).body).toEqual(bRequests[0].body);
    await page.reload(); const restored = await storageIntents(page); expect(restored).toEqual(afterA);
    const blockB = page.locator('.unresolved').filter({ hasText: b.id }); await blockB.getByRole('button', { name: 'Verificar situação' }).click(); await expect(page.getByRole('status').filter({ hasText: 'ainda não foi observada' })).toBeVisible();
    await blockB.getByRole('button', { name: 'Repetir mesma intenção' }).click(); await expect(page.getByRole('heading', { name: 'Sua reserva está confirmada.' })).toBeVisible(); expect(bRequests).toHaveLength(2); expect(bRequests[1]).toEqual(bRequests[0]);
    expect((await storageIntents(page)).map(item => item.key)).toEqual([aKey]); await page.locator('.unresolved').filter({ hasText: a.id }).getByRole('button', { name: 'Verificar situação' }).click(); await expect(page.locator('.unresolved')).toHaveCount(0);
  } finally { releaseA(); }
});

test('QA2: session draft retains base If-Match and dirty fields across focus refresh; explicit reopen adopts the new version', async ({ page, request }) => {
  const state = await (await request.get('http://127.0.0.1:3211/__test/state')).json(); await login(page, 'admin'); await page.goto(`/admin/aulas/${state.sessionId}`);
  const adminActor = (await (await page.request.get('/api/v1/session')).json()).data.userId;
  await page.getByRole('button', { name: 'Editar aula', exact: true }).click(); const dialog = page.getByRole('dialog');
  const original = (await (await page.request.get(`/api/v1/admin/sessions/${state.sessionId}`)).json()).data;
  await dialog.getByLabel('Título', { exact: true }).fill('TEST · Dirty draft A'); await dialog.getByLabel('Capacidade', { exact: true }).fill('2');
  const external = await page.request.patch(`/api/v1/admin/sessions/${state.sessionId}`, { headers: { Origin: origin, 'X-Expected-Actor': adminActor, 'If-Match': `"${original.version}"` }, data: { title: 'TEST · Committed externally v2' } }); expect(external.status()).toBe(200); const updated = (await external.json()).data;
  const refreshed = page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith(`/api/v1/admin/sessions/${state.sessionId}`));
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); expect((await (await refreshed).json()).data.version).toBe(updated.version);
  await expect(page.locator('h1')).toHaveText(updated.title); await expect(dialog.getByLabel('Título', { exact: true })).toHaveValue('TEST · Dirty draft A'); await expect(dialog.getByLabel('Capacidade', { exact: true })).toHaveValue('2');
  const saving = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(`/api/v1/admin/sessions/${state.sessionId}`));
  await dialog.getByRole('button', { name: 'Salvar aula', exact: true }).click(); const conflict = await saving;
  expect(conflict.request().headers()['if-match']).toBe(`"${original.version}"`); expect(conflict.status()).toBe(409); await expect(dialog.getByRole('alert')).toContainText('alterado por outra pessoa'); await expect(dialog.getByLabel('Título', { exact: true })).toHaveValue('TEST · Dirty draft A');
  const current = (await (await page.request.get(`/api/v1/admin/sessions/${state.sessionId}`)).json()).data; expect(current.version).toBe(updated.version); expect(current.title).toBe(updated.title); expect(current.capacity).toBe(original.capacity);
  await dialog.getByRole('button', { name: 'Descartar e fechar' }).click(); await page.getByRole('button', { name: 'Editar aula', exact: true }).click(); await expect(dialog.getByLabel('Título', { exact: true })).toHaveValue(updated.title);
  await dialog.getByLabel('Título', { exact: true }).fill('TEST · Reconciled draft saved');
  const resaving = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(`/api/v1/admin/sessions/${state.sessionId}`)); await dialog.getByRole('button', { name: 'Salvar aula', exact: true }).click(); const saved = await resaving; expect(saved.request().headers()['if-match']).toBe(`"${updated.version}"`); expect(saved.status()).toBe(200); await expect(dialog).toHaveCount(0); await expect(page.locator('h1')).toHaveText('TEST · Reconciled draft saved');
  // A successful save closes this draft. The next editor uses the committed
  // version instead of remaining permanently tied to the first snapshot.
  await page.getByRole('button', { name: 'Editar aula', exact: true }).click(); await dialog.getByLabel('Título', { exact: true }).fill('TEST · Next editing intention');
  const nextSaving = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(`/api/v1/admin/sessions/${state.sessionId}`)); await dialog.getByRole('button', { name: 'Salvar aula', exact: true }).click(); const next = await nextSaving; expect(next.request().headers()['if-match']).toBe(`"${(await saved.json()).data.version}"`); expect(next.status()).toBe(200);
});

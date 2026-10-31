// Independent QA audit. Uses the unchanged local Next/BFF and original SQL.
// The Auth HTTP harness is CONTROLLED, not GoTrue/SMTP or a JWT verifier.
import { test, expect, type Page, type APIResponse, type APIRequestContext } from '@playwright/test';
import { stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const origin = 'http://127.0.0.1:3210';
const headers = { Origin: origin };
async function login(page: Page, role: 'student' | 'admin') {
  await page.goto('/entrar');
  await page.getByLabel('E-mail', { exact: true }).fill(`${role}-ui@example.invalid`);
  await page.getByLabel('Senha', { exact: true }).fill('test-browser-password-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(role === 'admin' ? /\/admin$/ : /\/aluno$/);
}
async function privateStatus(response: APIResponse, status: number, code?: string) {
  expect(response.status()).toBe(status);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers().vary).toContain('Cookie');
  const json = await response.json();
  expect(JSON.stringify(json)).not.toMatch(/access_token|refresh_token|service_role_key|SQLSTATE/);
  if (code) expect(json.error.code).toBe(code);
  return json;
}
async function makeSession(api: APIRequestContext, state: { startsAt: string; instructorId: string; bikeIds: string[] }, suffix: string, days: number, status = 'published') {
  const start = new Date(state.startsAt); start.setUTCDate(start.getUTCDate() + days);
  return (await privateStatus(await api.post('/api/v1/admin/sessions', { headers, data: { title: `TEST · Independent audit ${suffix}`, instructorId: state.instructorId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 2700000).toISOString(), timezone: 'America/Sao_Paulo', capacity: 1, bikeMode: 'none', bikeIds: [state.bikeIds[0]], status } }), 200)).data;
}

test('AUDIT1: HTTP access boundaries, validation, capacity, IDOR, replay/history and UI logout', async ({ page, browser, request }, info) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const state = await (await request.get('http://127.0.0.1:3211/__test/state')).json();
  for (const path of ['session', 'me', 'sessions', 'me/reservations', 'admin/students', 'admin/settings']) await privateStatus(await page.request.get(`/api/v1/${path}`), 401, 'UNAUTHENTICATED');
  await page.goto('/admin/alunos'); await expect(page).toHaveURL(/\/entrar\?returnTo=/);
  await login(page, 'student');
  const studentIdentity = (await privateStatus(await page.request.get('/api/v1/session'), 200)).data;
  for (const path of ['students', 'instructors', 'bikes', 'sessions', 'reservations', 'attendance', 'settings']) await privateStatus(await page.request.get(`/api/v1/admin/${path}`), 403, 'FORBIDDEN');
  await privateStatus(await page.request.post('/api/v1/admin/bikes', { headers, data: { label: 'TEST forbidden' } }), 403, 'FORBIDDEN');
  const profile = (await privateStatus(await page.request.get('/api/v1/me'), 200)).data;
  await privateStatus(await page.request.patch('/api/v1/me', { headers: { ...headers, 'If-Match': `"${profile.version}"` }, data: { role: 'admin', active: true, userId: crypto.randomUUID() } }), 422, 'VALIDATION_ERROR');
  await privateStatus(await page.request.patch('/api/v1/me', { headers, data: { fullName: 'TEST audit' } }), 428, 'IF_MATCH_REQUIRED');
  await privateStatus(await page.request.patch('/api/v1/me', { headers: { Origin: 'https://foreign.example' }, data: { fullName: 'TEST audit' } }), 403, 'CSRF_REJECTED');
  await privateStatus(await page.request.post('/api/v1/auth/logout', { data: {} }), 403, 'CSRF_REJECTED');
  await privateStatus(await page.request.patch('/api/v1/me', { headers: { ...headers, 'If-Match': `"${profile.version}"` }, data: { fullName: 'X'.repeat(262145) } }), 413, 'BODY_TOO_LARGE');
  for (const path of ['sessions/not-a-uuid', 'sessions?limit=101', 'sessions?limit=1&limit=2', 'sessions?from=2026-10-31', 'sessions?unknown=true']) expect((await page.request.get(`/api/v1/${path}`)).status()).toBe(422);
  await privateStatus(await page.request.post('/api/v1/auth/reset-password', { headers, data: { password: 'test-audit-new-password-123' } }), 401, 'RECOVERY_INVALID');
  const recovery = await privateStatus(await page.request.post('/api/v1/auth/recovery', { headers, data: { email: 'absent-audit@example.invalid' } }), 200);
  expect(recovery.data.accepted).toBe(true); // Acceptance only: no SMTP claim.
  const confirmation = await page.request.get('/auth/confirm?token_hash=audit-controlled-token-hash&type=invite');
  expect(confirmation.status()).toBe(200); expect(confirmation.headers()['cache-control']).toContain('no-store');
  expect(await confirmation.text()).toContain('method="post"');
  expect((await page.request.post('/auth/confirm', { headers: { Origin: 'https://foreign.example' }, form: { tokenHash: 'audit-controlled-token-hash', type: 'invite' } })).status()).toBe(403);
  await page.goto('/auth/result?status=recovery_verified&next=//foreign.example'); await expect(page).toHaveURL(/\/redefinir-senha$/);
  await page.goto('/admin'); await expect(page.getByRole('heading', { name: 'Acesso não permitido' })).toBeVisible();
  await expect(page.getByText('Pré-cadastro browser')).toHaveCount(0);
  const adminContext = await browser.newContext({ baseURL: origin }); const admin = await adminContext.newPage();
  try {
    await login(admin, 'admin');
    const settings = (await privateStatus(await admin.request.get('/api/v1/admin/settings'), 200)).data;
    const session = await makeSession(admin.request, state, 'HTTP capacity', 20);
    const draft = await makeSession(admin.request, state, 'private draft', 21, 'draft');
    await privateStatus(await page.request.get(`/api/v1/sessions/${draft.id}`), 404, 'NOT_FOUND');
    await privateStatus(await page.request.get(`/api/v1/sessions/${draft.id}/bikes`), 404, 'NOT_FOUND');
    await privateStatus(await admin.request.patch('/api/v1/admin/settings', { headers: { ...headers, 'If-Match': `"${settings.version}"` }, data: { policies: { ...settings.policies, eligibility: { mode: 'restricted', maxActiveReservations: 0 } } } }), 422, 'VALIDATION_ERROR');
    const key = crypto.randomUUID();
    const created = (await privateStatus(await page.request.post('/api/v1/reservations', { headers: { ...headers, 'Idempotency-Key': key }, data: { sessionId: session.id } }), 200)).data;
    expect(created.currentResource.studentId).toBe(studentIdentity.studentId);
    await privateStatus(await page.request.post('/api/v1/reservations', { headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, data: { sessionId: session.id } }), 409, 'ALREADY_RESERVED');
    await privateStatus(await admin.request.post('/api/v1/reservations', { headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, data: { sessionId: session.id } }), 409, 'SESSION_FULL');
    expect((await privateStatus(await page.request.get(`/api/v1/sessions/${session.id}`), 200)).data.availability).toBe(0);
    await privateStatus(await admin.request.get(`/api/v1/reservations/${created.currentResource.id}`), 404, 'NOT_FOUND');
    await privateStatus(await admin.request.post(`/api/v1/reservations/${created.currentResource.id}/cancel`, { headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, data: {} }), 404, 'NOT_FOUND');
    expect((await privateStatus(await admin.request.get(`/api/v1/me/operations/${key}`), 200)).data.state).toBe('not_observed');
    const dto = (await privateStatus(await page.request.get('/api/v1/sessions'), 200)).data;
    expect(JSON.stringify(dto)).not.toMatch(/contactEmail|phone|invitedUserId|auth_revoked_before/);
    await privateStatus(await page.request.post(`/api/v1/reservations/${created.currentResource.id}/cancel`, { headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() }, data: {} }), 200);
    const replay = (await privateStatus(await page.request.post('/api/v1/reservations', { headers: { ...headers, 'Idempotency-Key': key }, data: { sessionId: session.id } }), 200)).data;
    expect(replay.replayed).toBe(true); expect(replay.currentResource.status).toBe('cancelled');
    expect((await privateStatus(await page.request.get(`/api/v1/sessions/${session.id}`), 200)).data.availability).toBe(1);
    expect((await privateStatus(await page.request.get('/api/v1/me/reservations?history=true'), 200)).data.items.some((item: { id: string }) => item.id === created.currentResource.id)).toBe(true);
    await admin.goto('/admin/alunos'); await admin.getByRole('button', { name: 'Adicionar aluno' }).click();
    const dialog = admin.getByRole('dialog'); await expect(dialog).toBeVisible();
    const focusTrail: { tag: string; inside: boolean; browserBoundary: boolean }[] = [];
    for (let i = 0; i < 10; i++) {
      await admin.keyboard.press('Tab');
      const focused = await dialog.evaluate(element => ({ tag: document.activeElement?.tagName ?? '', inside: element.contains(document.activeElement), browserBoundary: document.activeElement === document.body }));
      focusTrail.push(focused);
      // Native Chromium dialogs allow a browser-chrome Tab stop at the boundary.
      // Background document controls must stay inert; the next Tab re-enters.
      expect(focused.inside || focused.browserBoundary).toBe(true);
      if (focused.browserBoundary) { await admin.keyboard.press('Tab'); expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true); }
    }
    await info.attach('native-dialog-focus-trail', { body: JSON.stringify(focusTrail), contentType: 'application/json' });
    const semantics = await dialog.ariaSnapshot(); expect(semantics).toContain('Nome completo'); expect(semantics).toContain('Salvar cadastro');
    await info.attach('dialog-accessibility-tree', { body: semantics, contentType: 'text/plain' });
    await admin.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(admin.getByRole('button', { name: 'Adicionar aluno' })).toBeFocused();
    const cookies = await page.context().cookies(); expect(cookies.filter(cookie => cookie.name.startsWith('studio-auth')).every(cookie => cookie.httpOnly && cookie.sameSite === 'Lax')).toBe(true);
    await page.goto('/aluno/perfil');
    await page.evaluate(() => sessionStorage.setItem('studio:intents:v1', JSON.stringify({ actor: crypto.randomUUID(), items: [] })));
    await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(/\/entrar$/); expect(await page.evaluate(() => sessionStorage.getItem('studio:intents:v1'))).toBeNull();
    await privateStatus(await page.request.get('/api/v1/me'), 401, 'UNAUTHENTICATED');
    expect(errors).toEqual([]);
  } finally { await adminContext.close(); }
});

test('AUDIT2: pending intention must not execute under a different actor while focus verification is pending', async ({ page, context, request }, info) => {
  test.setTimeout(60000);
  const state = await (await request.get('http://127.0.0.1:3211/__test/state')).json();
  const otherTab = await context.newPage(); await login(otherTab, 'admin');
  const session = await makeSession(otherTab.request, state, 'actor boundary', 22);
  await login(page, 'student'); await page.goto(`/aluno/aulas/${session.id}`);
  const original = (await (await page.request.get('/api/v1/session')).json()).data;
  await page.route('**/api/v1/reservations', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click(); await expect(page.locator('.unresolved')).toBeVisible();
  await page.unroute('**/api/v1/reservations');
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let checking!: () => void; const checked = new Promise<void>(resolve => { checking = resolve; });
  await page.route('**/api/v1/session', async route => { checking(); await hold; await route.continue(); });
  try {
    await login(otherTab, 'admin'); // Shared cookies, separate tab storage/React tree.
    const current = (await (await otherTab.request.get('/api/v1/session')).json()).data;
    expect(current.userId).not.toBe(original.userId);
    await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await checked;
    const retry = page.getByRole('button', { name: 'Repetir mesma intenção' });
    const blockedInUI = await retry.isDisabled();
    const saving = blockedInUI ? Promise.resolve(null) : page.waitForResponse(response => response.url().endsWith('/api/v1/reservations') && response.request().method() === 'POST', { timeout: 3000 }).catch(() => null);
    if (!blockedInUI) await retry.click();
    const response = await saving;
    const reservations = (await privateStatus(await otherTab.request.get(`/api/v1/me/reservations?sessionId=${session.id}`), 200)).data.items;
    const proof = { status: response?.status() ?? null, blockedInUI, originalStudentId: original.studentId, currentStudentId: current.studentId, reservationCountForCurrentActor: reservations.length, reservedStudentId: reservations[0]?.studentId ?? null };
    const evidencePath = info.outputPath('actor-boundary-evidence.json'); await stat(dirname(evidencePath)); await writeFile(evidencePath, JSON.stringify(proof, null, 2));
    await info.attach('actor-boundary-evidence', { path: evidencePath, contentType: 'application/json' });
    // Acceptable: block/revalidate first, or bind the mutation atomically to its intended actor.
    // Current product must never apply A's stored intention to B's student profile.
    expect(proof.reservedStudentId, 'stored A intention was executed for actor B before verification completed').not.toBe(current.studentId);
  } finally { release(); await otherTab.close(); }
});

test('AUDIT3: visible form controls, names, unique IDs and responsive admin modal', async ({ page }, info) => {
  await login(page, 'admin'); await page.setViewportSize({ width: 320, height: 800 }); await page.goto('/admin/alunos');
  await page.getByRole('button', { name: 'Adicionar aluno' }).click(); const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  const issues = await dialog.evaluate(root => {
    const errors: string[] = [];
    for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="hidden"]),select,textarea')) {
      if (!control.labels?.length && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby')) errors.push(`unlabelled:${control.tagName}`);
    }
    for (const button of root.querySelectorAll('button')) if (!button.textContent?.trim() && !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby')) errors.push('unnamed:BUTTON');
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id); if (new Set(ids).size !== ids.length) errors.push('duplicate-id');
    if (document.documentElement.scrollWidth > innerWidth) errors.push('horizontal-overflow');
    return errors;
  });
  expect(issues).toEqual([]);
  await dialog.getByRole('button', { name: 'Salvar cadastro' }).click(); await expect(dialog.getByLabel('Nome completo')).toBeFocused();
  await page.screenshot({ path: info.outputPath('audit-admin-modal-320.png'), fullPage: true });
  await info.attach('modal-semantic-tree', { body: await dialog.ariaSnapshot(), contentType: 'text/plain' });
});

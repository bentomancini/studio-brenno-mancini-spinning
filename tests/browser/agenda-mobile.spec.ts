import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, role: string) {
  // Authenticate through the real BFF; this test targets layout, not login hydration.
  const response = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://127.0.0.1:3210' },
    data: { email: `${role}-ui@example.invalid`, password: 'test-browser-password-123' },
  });
  expect(response.status()).toBe(200);
  await page.goto(role === 'admin' ? '/admin' : '/aluno');
  await expect(page).toHaveURL(role === 'admin' ? /\/admin$/ : /\/aluno$/);
}

test('populated agenda: day/week, long content and no sideways movement', async ({ page, request }, info) => {
  test.setTimeout(180000);
  const state = await (await request.get('http://127.0.0.1:3211/__test/state')).json();
  await login(page, 'admin');
  const identity = (await (await page.request.get('/api/v1/session')).json()).data;
  const title = 'TEST · ' + 'AulaDeSpinning'.repeat(10);
  const startsAt = new Date(state.startsAt);
  startsAt.setUTCDate(startsAt.getUTCDate() + (info.project.name.includes('webkit') ? 8 : 7));
  const headers = { Origin: 'http://127.0.0.1:3210', 'X-Expected-Actor': identity.userId };
  const created = await page.request.post('/api/v1/admin/sessions', {
    headers,
    data: { title, instructorId: state.instructorId, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 2700000).toISOString(), timezone: 'America/Sao_Paulo', capacity: 1, bikeMode: 'required', bikeIds: [state.bikeIds[0]], status: 'published' },
  });
  expect(created.status()).toBe(200);
  const session = (await created.json()).data;
  const reserved = await page.request.post('/api/v1/reservations', {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: { sessionId: session.id, bikeId: state.bikeIds[0] },
  });
  expect(reserved.status()).toBe(200);
  for (const role of ['admin', 'student']) {
    if (role === 'student') await login(page, role);
    for (const width of [320, 375, 390, 430, 767, 844]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 850 });
      await page.goto(`/${role === 'admin' ? 'admin' : 'aluno'}/agenda`);
      await expect(page.getByLabel('Data de referência')).not.toHaveValue('');
      await expect(page.getByRole('button', { name: 'Dia', exact: true })).toBeEnabled();
      await expect(page.locator('.loading, .skeleton-screen')).toHaveCount(0);
      await page.getByLabel('Data de referência').fill(startsAt.toISOString().slice(0, 10));
      for (const mode of ['Dia', 'Semana']) {
        await page.getByRole('button', { name: mode, exact: true }).click();
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await expect(page.locator('.loading, .skeleton-screen')).toHaveCount(0);
        const dateBorder = await page.locator('.date-input-shell').boundingBox();
        const dateInput = await page.getByLabel('Data de referência').boundingBox();
        const instructor = await page.getByLabel('Instrutor nesta semana').boundingBox();
        expect(Math.abs(dateBorder!.x - instructor!.x)).toBeLessThan(1);
        expect(Math.abs(dateBorder!.width - instructor!.width)).toBeLessThan(1);
        expect(dateInput!.x).toBeGreaterThanOrEqual(dateBorder!.x);
        expect(dateInput!.x + dateInput!.width).toBeLessThanOrEqual(dateBorder!.x + dateBorder!.width);
        const geometry = await page.evaluate(() => ({
          width: innerWidth, scroll: document.documentElement.scrollWidth,
          outside: [...document.querySelectorAll<HTMLElement>('main *')].filter(el => {
            if (!el.getClientRects().length) return false;
            const box = el.getBoundingClientRect();
            return box.right > innerWidth + 1 || box.left < -1 || (['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1);
          }).map(el => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width })),
        }));
        expect(geometry, `${role} ${width} ${mode}`).toEqual({ width, scroll: width, outside: [] });
        await page.evaluate(() => window.scrollTo(100, 0));
        expect(await page.evaluate(() => scrollX)).toBe(0);
      }
      await page.screenshot({ path: info.outputPath(`${role}-${width}.png`), fullPage: true });
    }
  }
});

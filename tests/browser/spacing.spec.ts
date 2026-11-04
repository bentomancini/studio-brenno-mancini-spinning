import { test, expect } from '@playwright/test';

test('spacing: notices, reservation labels and detail headings on mobile and desktop', async ({ page, request }, info) => {
  test.setTimeout(90000);
  const state = await (await request.get('http://127.0.0.1:3211/__test/state')).json();
  await page.goto('/entrar');
  await page.getByLabel('E-mail', { exact: true }).fill('admin-ui@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('test-browser-password-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/aulas/${state.sessionId}`);
  await page.getByRole('button', { name: 'Reservar para aluno' }).click();
  await page.getByLabel('Aluno ativo', { exact: true }).selectOption(state.studentId);
  await page.getByLabel('Bicicleta disponível', { exact: true }).selectOption({ label: 'TEST-B01' });
  await page.getByRole('button', { name: 'Confirmar reserva para aluno' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Reserva confirmada' })).toBeVisible();

  for (const width of [320, 360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/admin/aulas/${state.sessionId}`);
    await expect(page.getByRole('article')).toBeVisible();
    const label = page.locator('p.hint').filter({ hasText: /^Aluno:/ }).filter({ hasNot: page.locator('code') }).first();
    const card = page.getByRole('article').first();
    const labelBox = await label.boundingBox(); const cardBox = await card.boundingBox();
    expect(cardBox!.y - labelBox!.y - labelBox!.height).toBeGreaterThanOrEqual(11);
    const back = page.getByRole('link', { name: '← Agenda do Studio' });
    const heading = page.locator('.page-heading').first();
    const backBox = await back.boundingBox(); const headingBox = await heading.boundingBox();
    expect(headingBox!.y - backBox!.y - backBox!.height).toBeGreaterThanOrEqual(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`detail-${width}.png`), fullPage: true });
    await page.goto('/admin/configuracoes');
    const notice = page.locator('main > .notice.warning');
    await expect(notice).toBeVisible();
    const noticeBox = await notice.boundingBox(); const formBox = await page.locator('main > form').boundingBox();
    expect(formBox!.y - noticeBox!.y - noticeBox!.height).toBeGreaterThanOrEqual(19);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`policies-${width}.png`), fullPage: true });
  }
});

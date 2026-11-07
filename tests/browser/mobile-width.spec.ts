import { test, expect, type Page } from '@playwright/test';

async function fits(page: Page) {
  await expect(page.locator('.loading, .skeleton-screen')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const overflowing = await page.locator('main, dialog[open]').evaluateAll(roots => roots.flatMap(root =>
    [...root.querySelectorAll<HTMLElement>('*')].filter(element => {
      if (!element.getClientRects().length || element.closest('dialog:not([open])')) return false;
      const style = getComputedStyle(element);
      return ['auto', 'scroll'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
    }).map(element => element.tagName + '.' + element.className)));
  expect(overflowing).toEqual([]);
}

test('mobile screens fit the viewport without horizontal scrolling', async ({ page, request }, info) => {
  test.setTimeout(180000);
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
  for (const width of [320, 360, 390, 767]) {
    await page.setViewportSize({ width, height: 850 });
    for (const path of ['/aluno', '/aluno/agenda', '/aluno/reservas', '/aluno/historico', '/aluno/perfil', `/aluno/aulas/${state.sessionId}`, '/admin', '/admin/agenda', '/admin/alunos', '/admin/instrutores', '/admin/bicicletas', '/admin/reservas', '/admin/configuracoes', `/admin/aulas/${state.sessionId}`]) {
      await page.goto(path); await expect(page.locator('h1').first()).toBeVisible();
      await fits(page);
      const main = await page.locator('main').boundingBox();
      expect(Math.abs(main!.x - (width - main!.x - main!.width))).toBeLessThan(1);
    }
    await page.goto('/admin/presencas');
    await page.getByLabel('Selecione uma aula').selectOption(state.sessionId);
    await expect(page.locator('tbody tr')).toHaveCount(1); await fits(page);
    await page.getByRole('button', { name: 'Presente', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Presença registrada' })).toBeVisible();
    await fits(page);
    await page.screenshot({ path: info.outputPath(`attendance-${width}.png`), fullPage: true });
    await page.goto('/admin/aulas/nova'); await expect(page.getByRole('dialog')).toBeVisible(); await fits(page);
    await page.screenshot({ path: info.outputPath(`editor-${width}.png`), fullPage: true });
  }
});

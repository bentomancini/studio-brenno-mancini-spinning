import { test, expect } from '@playwright/test';

let consoleIssues: string[] = [];
test.beforeEach(async ({ page }) => { consoleIssues = []; page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource.*(?:status of (?:401|403|409|422|503)|net::ERR_FAILED)/.test(message.text()) && !message.location().url.includes('/not-a-real-page')) consoleIssues.push(`${message.text()} [${message.location().url}]`); }); });
test.afterEach(() => expect(consoleIssues).toEqual([]));
const sizes = [{ width: 320, height: 800 }, { width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];
test('public UI, native validation, real 503, guards and responsive evidence without configured provider', async ({ page }, info) => {
  test.setTimeout(120000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const [path, name] of [['/', 'landing'], ['/entrar', 'login'], ['/cadastro', 'signup'], ['/recuperar-senha', 'recovery'], ['/redefinir-senha', 'reset']]) {
      await page.goto(path); await expect(page.locator('h1')).toBeVisible(); await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.fonts.check('400 16px "Source Sans 3"'))).toBe(true);
      if (path === '/') expect(await page.evaluate(() => document.fonts.check('700 16px "Barlow Condensed"'))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${name}-${size.width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize(sizes[1]); await page.goto('/'); await page.getByRole('link', { name: 'Ver agenda', exact: true }).click();
  await expect(page).toHaveURL(/\/entrar\?returnTo=/);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await expect(page.getByLabel('E-mail', { exact: true })).toBeFocused();
  expect(await page.getByLabel('E-mail', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await page.getByLabel('E-mail', { exact: true }).fill('test-ui@example.invalid'); await page.getByLabel('Senha', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Mostrar senha', exact: true }).click(); await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ocultar senha', exact: true }).click();
  const response = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click(); expect((await response).status()).toBe(503);
  await expect(page.getByRole('alert').filter({ hasText: 'O serviço está indisponível' })).toBeVisible(); await expect(page).toHaveURL(/\/entrar/);
  for (const path of ['/aluno', '/aluno/agenda', '/admin', '/admin/alunos', '/admin/agenda']) { await page.goto(path); await expect(page.getByRole('heading', { name: 'O Studio está indisponível no momento' })).toBeVisible(); await expect(page.getByRole('link', { name: 'Ir para entrar' })).toBeVisible(); }
  await page.screenshot({ path: info.outputPath('private-unavailable-360.png'), fullPage: true });
  await page.goto('/auth/result?status=recovery_verified&next=https://evil.example'); await expect(page).toHaveURL(/\/redefinir-senha$/);
  await page.goto('/auth/confirm?token_hash=browser-test-confirm-hash&type=invite'); await expect(page.getByRole('button', { name: 'Confirmar acesso' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar acesso' }).click(); await expect(page.getByRole('heading', { name: 'Validação indisponível' })).toBeVisible();
  await page.goto('/not-a-real-page'); await expect(page.getByRole('heading', { name: 'Este caminho não está na agenda.' })).toBeVisible();
  await page.goto('/entrar'); await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
  expect(errors).toEqual([]);
});

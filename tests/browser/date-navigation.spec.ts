import { test, expect } from '@playwright/test';

test('mobile date navigation keeps date, arrows and Today separated', async ({ page }, info) => {
  await page.goto('/entrar');
  await page.getByLabel('E-mail', { exact: true }).fill('admin-ui@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('test-browser-password-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  for (const width of [320, 360, 390, 767]) {
    await page.setViewportSize({ width, height: 850 });
    for (const area of ['aluno', 'admin']) {
      await page.goto(`/${area}/agenda`);
      const date = page.getByLabel('Data de referência');
      await expect(date).not.toHaveValue('');
      const previous = page.getByRole('button', { name: 'Dia anterior', exact: true });
      const next = page.getByRole('button', { name: 'Próximo dia', exact: true });
      const today = page.getByRole('button', { name: 'Hoje', exact: true });
      const [a, b, c, d] = await Promise.all([previous.boundingBox(), date.boundingBox(), next.boundingBox(), today.boundingBox()]);
      expect(a!.y - b!.y - b!.height).toBeGreaterThanOrEqual(11);
      expect(c!.y - b!.y - b!.height).toBeGreaterThanOrEqual(11);
      expect(d!.x - a!.x - a!.width).toBeGreaterThanOrEqual(11);
      expect(c!.x - d!.x - d!.width).toBeGreaterThanOrEqual(11);
      expect(d!.y - b!.y - b!.height).toBeGreaterThanOrEqual(11);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const original = await date.inputValue();
      await next.click(); await expect(date).not.toHaveValue(original);
      await today.click(); await expect(date).toHaveValue(original);
      await page.screenshot({ path: info.outputPath(`${area}-date-${width}.png`), fullPage: true });
    }
  }
});

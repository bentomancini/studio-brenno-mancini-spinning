import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, role: 'admin' | 'student') {
  await page.goto('/entrar');
  await page.getByLabel('E-mail', { exact: true }).fill(`${role}-ui@example.invalid`);
  await page.getByLabel('Senha', { exact: true }).fill('test-browser-password-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(role === 'admin' ? /\/admin$/ : /\/aluno$/);
}

test('admin catalog search finds matching records through the server', async ({ page }) => {
  await login(page, 'admin');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/admin/alunos');
  const search = page.getByLabel('Buscar em todos os cadastros');
  const response = page.waitForResponse(r => r.url().includes('/api/v1/admin/students?') && r.url().includes('q=') && r.status() === 200);
  await search.fill('Aluno UI');
  await response;
  await expect(page.getByRole('heading', { name: 'TEST · Aluno UI' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'TEST · Admin UI' })).toHaveCount(0);
  await search.fill('nome-inexistente-test');
  await expect(page.getByText('Nenhum cadastro encontrado.')).toBeVisible();
});

test('student cancelled-history filter requests a filtered page and can be cleared', async ({ page }) => {
  await login(page, 'student');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/aluno/historico');
  const checkbox = page.getByLabel('Somente canceladas');
  const response = page.waitForResponse(r => r.url().includes('/api/v1/me/reservations?') && r.url().includes('cancelledOnly=true'));
  await checkbox.check();
  expect((await response).status()).toBe(200);
  await expect(page.getByText('Nenhuma reserva cancelada')).toBeVisible();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByText('Seu histórico ainda está em branco.')).toBeVisible();
});

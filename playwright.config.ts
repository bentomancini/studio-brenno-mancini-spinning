import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, retries: 0, timeout: 45000,
  expect: { timeout: 12000 }, reporter: [['list'], ['html', { open: 'never' }]],
  use: { browserName: 'chromium', headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined }, trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' },
  projects: [
    { name: 'runtime-no-provider', testMatch: /unconfigured\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:3212' } },
    { name: 'controlled-auth-real-sql', testMatch: /(?:product|qa-regressions)\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:3210' } },
  ],
  webServer: [
    { command: 'node --import tsx tests/browser/harness.mts', url: 'http://127.0.0.1:3210', timeout: 120000, reuseExistingServer: false },
    { command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3212', url: 'http://127.0.0.1:3212', env: { APP_ENV: 'test', APP_ORIGIN: 'http://127.0.0.1:3212', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', RATE_LIMIT_SECRET: '' }, timeout: 60000, reuseExistingServer: false },
  ],
});

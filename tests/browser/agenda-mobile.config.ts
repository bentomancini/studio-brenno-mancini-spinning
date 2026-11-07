import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from '../../playwright.config';

export default defineConfig({
  ...base,
  testDir: resolve('tests/browser'),
  testMatch: 'agenda-mobile.spec.ts',
  use: { ...base.use, launchOptions: {}, baseURL: 'http://127.0.0.1:3210', isMobile: true, hasTouch: true },
  projects: [
    { name: 'agenda-chromium', use: { browserName: 'chromium' } },
    { name: 'agenda-webkit', use: { browserName: 'webkit' } },
  ],
  webServer: [{ command: 'node --import tsx tests/browser/harness.mts', url: 'http://127.0.0.1:3210', cwd: process.cwd(), timeout: 120000, reuseExistingServer: false }],
});

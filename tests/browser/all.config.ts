// Complete browser entry point, within the frontend-owned scope. The root
// configuration stays unchanged; this explicitly includes independent audits.
import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from '../../playwright.config';

const root = process.cwd();
export default defineConfig({
  ...base,
  testDir: resolve(root, 'tests/browser'), outputDir: resolve(root, 'test-results'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? resolve(root, 'playwright-report') }]],
  projects: base.projects?.map(project => project.name === 'controlled-auth-real-sql' ? { ...project, testMatch: '**/*.spec.ts', testIgnore: '**/unconfigured.spec.ts' } : project),
  webServer: (Array.isArray(base.webServer) ? base.webServer : base.webServer ? [base.webServer] : []).map(server => ({ ...server, cwd: root })),
});

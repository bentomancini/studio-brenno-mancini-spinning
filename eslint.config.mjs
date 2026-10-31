import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from '@next/eslint-plugin-next';
import globals from 'globals';

export default defineConfig([
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**', 'test-results/**', 'playwright-report/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['src/**/*.{ts,tsx}'], plugins: { '@next/next': next }, rules: { ...next.configs.recommended.rules, ...next.configs['core-web-vitals'].rules } },
]);

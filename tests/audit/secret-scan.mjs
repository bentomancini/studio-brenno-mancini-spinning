// Read-only, sanitizing heuristic scan; no credential values or source snippets are printed.
// Never reads actual .env files, dependencies, Git internals or private user data.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const clientRoot = process.argv[2] ? resolve(process.argv[2]) : null;
const output = process.argv[3] ? resolve(process.argv[3]) : null;
const approved = resolve('C:/Users/bento/AppData/Local/Temp/opencode');
if (clientRoot && !clientRoot.startsWith(approved + '\\') && !clientRoot.startsWith(approved + '/')) throw new Error('Client build must be inside approved temp');
if (output && !output.startsWith(approved + '\\') && !output.startsWith(approved + '/')) throw new Error('Output must be inside approved temp');
const findings = []; let sourceFiles = 0; let clientFiles = 0;
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['aws-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['provider-secret', /\b(?:sb_secret_[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,})\b/g],
  ['literal-jwt', /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g],
];
async function scan(path, client = false) {
  const info = await stat(path);
  if (info.isDirectory()) { for (const name of (await readdir(path)).sort()) await scan(join(path, name), client); return; }
  if (!/\.(?:[cm]?[jt]sx?|jsonc?|md|sql|toml|ya?ml|css|svg|example)$/.test(path)) return;
  if (client) clientFiles++; else sourceFiles++;
  const text = await readFile(path, 'utf8');
  for (const [category, pattern] of rules) {
    for (const match of text.matchAll(pattern)) findings.push({ path: client ? `BUILD_CLIENT/${relative(clientRoot, path).replaceAll('\\', '/')}` : relative(root, path).replaceAll('\\', '/'), line: text.slice(0, match.index).split('\n').length, category });
  }
  if (client) for (const identifier of ['SUPABASE_SERVICE_ROLE_KEY', 'RATE_LIMIT_SECRET']) if (text.includes(identifier)) findings.push({ path: `BUILD_CLIENT/${relative(clientRoot, path).replaceAll('\\', '/')}`, category: 'server-only-identifier', identifier });
}
for (const name of ['src', 'tests', 'scripts', 'docs', 'supabase', '.github', '.env.example', 'README.md', 'package.json', 'package-lock.json', 'next.config.ts', 'playwright.config.ts', 'vitest.config.mts', 'tsconfig.json']) await scan(join(root, name));
if (clientRoot) await scan(clientRoot, true);
const report = { timestamp: new Date().toISOString(), mode: 'heuristic-read-only-no-secrets-printed', sourceFiles, clientFiles, findings, limits: 'Not a full entropy/history/dependency scan; test placeholders remain synthetic; no actual .env values read.' };
if (output) { await stat(resolve(output, '..')); await writeFile(output, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
process.exitCode = findings.length ? 1 : 0;

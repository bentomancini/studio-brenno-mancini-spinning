// Build-tool workaround for filesystems that cannot support npm's native links.
// Produces a source-only snapshot in an explicitly supplied LOCAL temp directory.
// Never copies .env files, Git internals, user data, dependencies or build output.
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = resolve(process.argv[2] ?? '');
const approvedTemp = resolve(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp');
if (!process.argv[2] || !target.startsWith(approvedTemp + '\\') && !target.startsWith(approvedTemp + '/')) throw new Error('Target must be inside the OS temporary directory');
await stat(resolve(target, '..'));
await mkdir(target, { recursive: true });
try { await stat(join(target, '.git')); throw new Error('Refusing to overwrite a Git checkout'); } catch(error) { if (error.code !== 'ENOENT') throw error; }
const entries = ['src', 'supabase', 'tests', 'scripts', 'docs', 'package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.ts', 'eslint.config.mjs', 'vitest.config.ts', 'vitest.config.mts', 'playwright.config.ts', 'README.md'];
const hash = createHash('sha256');
async function digest(path, relative) {
  const info = await stat(path);
  if (info.isDirectory()) { for (const child of (await readdir(path)).sort()) await digest(join(path, child), `${relative}/${child}`); }
  else { hash.update(relative); hash.update(await readFile(path)); }
}
for (const entry of entries) {
  // This is explicitly a generated verification workspace, not another checkout.
  // Remove allowlisted generated copies first, so renamed/deleted sources cannot survive.
  await rm(join(target, entry), { recursive: true, force: true });
  try { await stat(join(root, entry)); } catch { continue; }
  await digest(join(root, entry), entry);
  await cp(join(root, entry), join(target, entry), { recursive: true, force: true });
}
console.log(`Source snapshot SHA-256: ${hash.digest('hex')}`);
console.log(`Verification directory: ${target}`);

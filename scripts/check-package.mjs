import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTarball, root, run } from './package-utils.mjs';

const tarball = await createTarball(resolve(root, '.tmp/package-check'));
const listing = await run('tar', ['-tzf', tarball], { capture: true });
const files = listing.stdout.trim().split('\n').filter(Boolean);
const unexpected = files.filter(
  (file) =>
    !file.startsWith('package/dist/') &&
    !['package/package.json', 'package/README.md', 'package/LICENSE'].includes(file),
);
if (unexpected.length > 0) throw new Error(`Unexpected packed files:\n${unexpected.join('\n')}`);
for (const required of [
  'package/dist/esm/index.js',
  'package/dist/esm/node/index.js',
  'package/dist/esm/auth0/index.js',
  'package/dist/esm/test/index.js',
  'package/dist/esm/apps/index.js',
  'package/dist/esm/index.d.ts',
  'package/dist/cjs/index.js',
  'package/dist/cjs/node/index.js',
  'package/dist/cjs/auth0/index.js',
  'package/dist/cjs/test/index.js',
  'package/dist/cjs/apps/index.js',
  'package/dist/cjs/index.d.ts',
  'package/dist/cjs/package.json',
  'package/dist/esm/shared/jose-loader.cjs',
  'package/dist/esm/shared/jose-runtime.cjs',
  'package/dist/cjs/shared/jose-loader.cjs',
  'package/dist/cjs/shared/jose-runtime.cjs',
  'package/dist/JOSE-LICENSE.md',
  'package/LICENSE',
  'package/README.md',
]) {
  if (!files.includes(required)) throw new Error(`Packed artifact is missing ${required}`);
}
for (const path of [
  'dist/esm/index.js',
  'dist/esm/node/index.js',
  'dist/esm/auth0/index.js',
  'dist/cjs/index.js',
  'dist/cjs/node/index.js',
  'dist/cjs/auth0/index.js',
]) {
  const source = await readFile(resolve(root, path), 'utf8');
  if (/PRIVATE (?:RSA )?KEY/u.test(source))
    throw new Error(`Private key material found in ${path}`);
}
console.log(`packed artifact contains ${files.length} intended files only`);

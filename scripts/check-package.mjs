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
  'package/dist/index.js',
  'package/dist/node/index.js',
  'package/dist/auth0/index.js',
  'package/dist/test/index.js',
  'package/dist/index.d.ts',
  'package/LICENSE',
  'package/README.md',
]) {
  if (!files.includes(required)) throw new Error(`Packed artifact is missing ${required}`);
}
for (const path of ['dist/index.js', 'dist/node/index.js', 'dist/auth0/index.js']) {
  const source = await readFile(resolve(root, path), 'utf8');
  if (/PRIVATE (?:RSA )?KEY/u.test(source))
    throw new Error(`Private key material found in ${path}`);
}
console.log(`packed artifact contains ${files.length} intended files only`);

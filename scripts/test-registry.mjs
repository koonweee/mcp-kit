import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root, run } from './package-utils.mjs';

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const requested = process.argv.slice(2).find((argument) => argument !== '--');
const version = requested?.startsWith('v')
  ? requested.slice(1)
  : (requested ?? packageJson.version);
if (version !== packageJson.version) {
  throw new Error(`Registry version ${version} does not match package.json ${packageJson.version}`);
}

const spec = `${packageJson.name}@${version}`;
let published;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const result = await run(
      'npm',
      ['view', spec, 'name', 'version', 'dist.tarball', 'dist.integrity', '--json'],
      { capture: true },
    );
    published = JSON.parse(result.stdout);
    break;
  } catch (error) {
    if (attempt === 12) throw error;
    await delay(5_000);
  }
}
if (
  published?.name !== packageJson.name ||
  published?.version !== version ||
  typeof published?.['dist.tarball'] !== 'string' ||
  typeof published?.['dist.integrity'] !== 'string'
) {
  throw new Error(`Registry metadata is incomplete for ${spec}`);
}

const workspace = await mkdtemp(join(tmpdir(), 'mcp-kit-registry-'));
try {
  await writeFile(
    join(workspace, 'package.json'),
    JSON.stringify({ name: 'mcp-kit-registry-test', private: true, type: 'module' }, null, 2),
  );
  await run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-package-lock',
      '--registry=https://registry.npmjs.org',
      '--save-exact',
      spec,
    ],
    { cwd: workspace },
  );
  await writeFile(
    join(workspace, 'index.mjs'),
    `
const surfaces = await Promise.all([
  import('@koonweee/mcp-kit'),
  import('@koonweee/mcp-kit/node'),
  import('@koonweee/mcp-kit/auth0'),
  import('@koonweee/mcp-kit/test'),
]);
for (const [index, surface] of surfaces.entries()) {
  if (Object.keys(surface).length === 0) throw new Error('empty public subpath ' + index);
}
if (typeof surfaces[3].createTestJwtAuthority !== 'function') throw new Error('test helper missing');
console.log('all four public subpaths imported from ${spec}');
`,
  );
  await run(process.execPath, ['index.mjs'], { cwd: workspace });
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log(`verified registry metadata, integrity, installation, and imports for ${spec}`);

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
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
const registryLookupAttempts = 60;
const registryLookupDelayMs = 5_000;
let published;
for (let attempt = 1; attempt <= registryLookupAttempts; attempt += 1) {
  try {
    const result = await run(
      'npm',
      ['view', spec, 'name', 'version', 'dist.tarball', 'dist.integrity', '--json'],
      { capture: true },
    );
    published = JSON.parse(result.stdout);
    break;
  } catch (error) {
    if (attempt === registryLookupAttempts) throw error;
    await delay(registryLookupDelayMs);
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
  import('@koonweee/mcp-kit/apps'),
]);
for (const [index, surface] of surfaces.entries()) {
  if (Object.keys(surface).length === 0) throw new Error('empty public subpath ' + index);
}
if (typeof surfaces[3].createTestJwtAuthority !== 'function') throw new Error('test helper missing');
if (typeof surfaces[4].createMcpAppRuntime !== 'function') throw new Error('Apps runtime missing');
console.log('all five public subpaths imported from ${spec}');
`,
  );
  await writeFile(
    join(workspace, 'index.cjs'),
    `
const surfaces = [
  require('@koonweee/mcp-kit'),
  require('@koonweee/mcp-kit/node'),
  require('@koonweee/mcp-kit/auth0'),
  require('@koonweee/mcp-kit/test'),
  require('@koonweee/mcp-kit/apps'),
];
for (const [index, surface] of surfaces.entries()) {
  if (Object.keys(surface).length === 0) throw new Error('empty CommonJS public subpath ' + index);
}
void (async () => {
  const authority = await surfaces[3].createTestJwtAuthority();
  const token = await authority.sign({ scope: 'registry:read' });
  if (token.split('.').length !== 3) throw new Error('CommonJS registry JWT helper failed');
  if (typeof surfaces[4].createMcpAppRuntime !== 'function') throw new Error('CommonJS Apps runtime missing');
  console.log('all five CommonJS public subpaths required from ${spec}');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`,
  );
  await run('npm', ['audit', 'signatures'], { cwd: workspace });
  await run(process.execPath, ['index.mjs'], { cwd: workspace });
  await run(process.execPath, ['index.cjs'], { cwd: workspace });
  await writeFile(
    join(workspace, 'browser-entry.js'),
    `import { createMcpAppRuntime } from '@koonweee/mcp-kit/apps';\nglobalThis.__mcpKitBrowserRuntime = typeof createMcpAppRuntime;\nglobalThis.__mcpKitUpdateModelContext = (runtime) => typeof runtime.app.updateModelContext;\n`,
  );
  await build({
    absWorkingDir: workspace,
    entryPoints: ['browser-entry.js'],
    outfile: join(workspace, 'browser-bundle.cjs'),
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    logLevel: 'silent',
  });
  await run(process.execPath, ['browser-bundle.cjs'], { cwd: workspace });
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log(`verified registry metadata, integrity, installation, and imports for ${spec}`);

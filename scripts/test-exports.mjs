import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTarball, fileDependency, installOffline, root, run } from './package-utils.mjs';

const workspace = await mkdtemp(join(tmpdir(), 'mcp-kit-exports-'));
try {
  const tarball = await createTarball(resolve(root, '.tmp/exports-pack'));
  await writeFile(
    join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'mcp-kit-external-export-test',
        private: true,
        type: 'module',
        dependencies: { '@jtkw/mcp-kit': fileDependency(tarball) },
        devDependencies: {
          '@types/node': '24.13.3',
          typescript: '6.0.3',
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(workspace, 'index.mjs'),
    `
const surfaces = await Promise.all([
  import('@jtkw/mcp-kit'),
  import('@jtkw/mcp-kit/node'),
  import('@jtkw/mcp-kit/auth0'),
  import('@jtkw/mcp-kit/test'),
]);
for (const [index, surface] of surfaces.entries()) {
  if (Object.keys(surface).length === 0) throw new Error('empty public subpath ' + index);
}
for (const privatePath of ['@jtkw/mcp-kit/cloudflare', '@jtkw/mcp-kit/dist/core/definition.js']) {
  try {
    await import(privatePath);
    throw new Error('private path unexpectedly exported: ' + privatePath);
  } catch (error) {
    if (String(error).includes('unexpectedly exported')) throw error;
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
  }
}
if (typeof surfaces[3].createTestJwtAuthority !== 'function') throw new Error('test helper missing');
console.log('all four public subpaths imported from the packed artifact');
`,
  );
  await writeFile(
    join(workspace, 'index.ts'),
    `
import { defineServer, defineTool, type McpPrincipal } from '@jtkw/mcp-kit';
import { createNodeMcpHandler, type NodeMcpHandler } from '@jtkw/mcp-kit/node';
import { createAuth0Verifier, type Auth0VerifierOptions } from '@jtkw/mcp-kit/auth0';
import { connectInMemory, createTestPrincipal, type InMemoryMcpClient } from '@jtkw/mcp-kit/test';

const principal: McpPrincipal = createTestPrincipal();
const authOptions = {} as Auth0VerifierOptions;
const verifier = createAuth0Verifier(authOptions);
const tool = defineTool<Record<string, never>>();
const definition = defineServer<Record<string, never>>()({ name: 'types', version: '1.0.0', tools: [] });
const handler: NodeMcpHandler = createNodeMcpHandler(definition, { dependencies: () => ({}) });
const connection: Promise<InMemoryMcpClient> = connectInMemory(
  definition,
  { requestId: 'types', principal, logger: { log() {}, error() {} }, dependencies: {} },
);
void [tool, verifier, handler, connection];
`,
  );
  await writeFile(
    join(workspace, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
          strict: true,
          noEmit: true,
        },
        include: ['index.ts'],
      },
      null,
      2,
    ),
  );
  await installOffline(workspace);
  await run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: workspace });
  await run(process.execPath, ['index.mjs'], { cwd: workspace });
} finally {
  await rm(workspace, { recursive: true, force: true });
}

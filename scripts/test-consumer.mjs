import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createTarball, fileDependency, installOffline, root, run } from './package-utils.mjs';

const workspace = await mkdtemp(join(tmpdir(), 'mcp-kit-consumer-'));
try {
  const tarball = await createTarball(resolve(root, '.tmp/consumer-pack'));
  await cp(resolve(root, 'examples/basic-node/src'), join(workspace, 'src'), { recursive: true });
  await writeFile(
    join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: 'mcp-kit-external-consumer-test',
        private: true,
        type: 'module',
        dependencies: {
          '@koonweee/mcp-kit': fileDependency(tarball),
          zod: '4.4.3',
        },
        devDependencies: {
          '@modelcontextprotocol/client': '2.0.0',
          '@types/node': '24.13.3',
          typescript: '6.0.3',
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(workspace, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          types: ['node'],
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          verbatimModuleSyntax: true,
          rootDir: 'src',
          outDir: 'dist',
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(workspace, 'smoke.mjs'),
    `
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createTestJwtAuthority } from '@koonweee/mcp-kit/test';
import { getAuth0ProtectedResourceMetadataUrl } from '@koonweee/mcp-kit/auth0';
import { startExample } from './dist/server.js';

const authority = await createTestJwtAuthority();
const running = await startExample({
  issuer: authority.issuer,
  audience: authority.audience,
  jwksUri: authority.jwksUri,
  jwks: { fetch: authority.fetch, cooldownMs: 0 },
  hostname: '127.0.0.1',
  port: 0,
});
const makeClient = async (scope) => {
  const token = await authority.sign({ scope });
  const client = new Client(
    { name: 'packed-consumer', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', running.url), {
    requestInit: { headers: { authorization: 'Bearer ' + token } },
  });
  await client.connect(transport);
  return client;
};
try {
  const health = await fetch(new URL('/healthz', running.url));
  if (health.status !== 200) throw new Error('health failed');
  const metadataPath = new URL(getAuth0ProtectedResourceMetadataUrl(authority.audience)).pathname;
  const metadata = await (await fetch(new URL(metadataPath, running.url))).json();
  if (metadata.resource !== authority.audience) throw new Error('metadata resource mismatch');
  const unauthenticated = await fetch(new URL('/mcp', running.url), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  if (unauthenticated.status !== 401) throw new Error('missing 401');

  const allowed = await makeClient('example:read example:write');
  const names = (await allowed.listTools()).tools.map((tool) => tool.name).sort();
  if (names.join(',') !== 'read-status,write-status') throw new Error('tool listing failed');
  const read = await allowed.callTool({ name: 'read-status', arguments: {} });
  const write = await allowed.callTool({ name: 'write-status', arguments: { value: 'allowed-value' } });
  if (read.isError || write.isError) throw new Error('allowed tool call failed');
  const changed = await allowed.callTool({ name: 'read-status', arguments: {} });
  if (changed.content?.[0]?.text !== 'allowed-value') throw new Error('allowed write did not reach backend');
  await allowed.close();

  const limited = await makeClient('example:read');
  const secret = 'SENSITIVE_DENIED_VALUE_7f34';
  const denied = await limited.callTool({ name: 'write-status', arguments: { value: secret } });
  if (!denied.isError || JSON.stringify(denied).includes(secret)) throw new Error('scope denial failed');
  const unchanged = await limited.callTool({ name: 'read-status', arguments: {} });
  if (unchanged.content?.[0]?.text !== 'allowed-value') throw new Error('denied call reached backend');
  await limited.close();
  console.log('packed external consumer compiled and passed authenticated smoke checks');
} finally {
  await running.close();
}
`,
  );
  await installOffline(workspace);
  await run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: workspace });
  await run(process.execPath, ['smoke.mjs'], { cwd: workspace });
} finally {
  await rm(workspace, { recursive: true, force: true });
}

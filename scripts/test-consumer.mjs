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
import { mcpExtensionErrorBoundary } from '@koonweee/mcp-kit';
import { createTestJwtAuthority } from '@koonweee/mcp-kit/test';
import { getAuth0ProtectedResourceMetadataUrl } from '@koonweee/mcp-kit/auth0';
import { startExample } from './dist/server.js';

const authority = await createTestJwtAuthority();
const privateExtensionFailure = 'PRIVATE_ESM_EXTENSION_FAILURE';
try {
  await mcpExtensionErrorBoundary.wrap(async () => {
    throw new Error(privateExtensionFailure);
  })();
  throw new Error('ESM extension boundary did not reject');
} catch (error) {
  if (error?.code !== -32603 || error?.message !== 'The MCP request could not be completed') {
    throw error;
  }
  if (String(error).includes(privateExtensionFailure) || error?.data !== undefined || error?.cause !== undefined) {
    throw new Error('ESM extension boundary leaked private failure data');
  }
}
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
  const listedTools = (await allowed.listTools()).tools;
  const names = listedTools.map((tool) => tool.name).sort();
  if (names.join(',') !== 'read-status,write-status') throw new Error('tool listing failed');
  const readTool = listedTools.find((tool) => tool.name === 'read-status');
  const writeTool = listedTools.find((tool) => tool.name === 'write-status');
  if (readTool?.outputSchema?.properties?.status?.type !== 'string') {
    throw new Error('typed output schema was not advertised');
  }
  if (readTool?._meta?.['example.dev/category'] !== 'status') {
    throw new Error('tool metadata was not advertised');
  }
  if (readTool?._meta?.ui?.resourceUri !== 'ui://status/card-v1.html') {
    throw new Error('MCP Apps tool linkage was not advertised');
  }
  if (writeTool?.outputSchema !== undefined || writeTool?._meta !== undefined) {
    throw new Error('optional tool fields changed untyped tool discovery');
  }
  const listedResources = (await allowed.listResources()).resources;
  if (!listedResources.some((resource) => resource.uri === 'ui://status/card-v1.html')) {
    throw new Error('MCP Apps resource was not advertised');
  }
  const appResource = await allowed.readResource({ uri: 'ui://status/card-v1.html' });
  if (
    appResource.contents[0]?.mimeType !== 'text/html;profile=mcp-app' ||
    appResource.contents[0]?._meta?.ui?.domain !== 'https://widgets.example.com'
  ) {
    throw new Error('MCP Apps resource contents were not serialized');
  }
  const read = await allowed.callTool({ name: 'read-status', arguments: {} });
  const write = await allowed.callTool({ name: 'write-status', arguments: { value: 'allowed-value' } });
  if (read.isError || read.structuredContent?.status !== 'ready' || write.isError) {
    throw new Error('allowed tool call failed');
  }
  const changed = await allowed.callTool({ name: 'read-status', arguments: {} });
  if (changed.content?.[0]?.text !== 'allowed-value') throw new Error('allowed write did not reach backend');
  await allowed.close();

  const resourceLimited = await makeClient('example:write');
  try {
    await resourceLimited.readResource({ uri: 'ui://status/card-v1.html' });
    throw new Error('scoped MCP Apps resource unexpectedly succeeded');
  } catch (error) {
    if (
      error?.code !== -32603 ||
      error?.message !== 'Insufficient scope' ||
      error?.data !== undefined ||
      error?.cause !== undefined
    ) {
      throw error;
    }
  } finally {
    await resourceLimited.close();
  }

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
  await writeFile(
    join(workspace, 'smoke.cjs'),
    `
const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
const { defineAppResource, defineServer, defineTool, mcpExtensionErrorBoundary } = require('@koonweee/mcp-kit');
const { serveNode } = require('@koonweee/mcp-kit/node');
const {
  createAuth0BearerGate,
  createAuth0ProtectedResourceHandler,
  createAuth0Verifier,
  getAuth0ProtectedResourceMetadataUrl,
  principalFromAuthInfo,
} = require('@koonweee/mcp-kit/auth0');
const { createTestJwtAuthority } = require('@koonweee/mcp-kit/test');
const { z } = require('zod/v4');

void (async () => {
  const authority = await createTestJwtAuthority();
  const read = defineTool()({
    name: 'commonjs-read',
    description: 'Read through the CommonJS package surface',
    inputSchema: z.object({}),
    outputSchema: z.object({ value: z.string() }),
    requiredScopes: ['example:read'],
    risk: { kind: 'read' },
    handler: (_input, context) => {
      if (context.client.protocolEra !== 'legacy') {
        throw new Error('CommonJS consumer client era mismatch');
      }
      if (context.client.inputRequired.formElicitation) {
        throw new Error('CommonJS consumer unexpectedly reported form input support');
      }
      return {
        content: [{ type: 'text', text: 'commonjs-ready' }],
        structuredContent: { value: 'commonjs-ready' },
      };
    },
  });
  const appResource = defineAppResource()({
    name: 'commonjs-app',
    uri: 'ui://commonjs/app-v1.html',
    requiredScopes: ['example:read'],
    html: '<html>commonjs-app-ready</html>',
  });
  const definition = defineServer()({
    name: 'commonjs-consumer',
    version: '1.0.0',
    apps: { resources: [appResource] },
    tools: [read],
    extend(server) {
      server.registerResource(
        'private-commonjs-resource',
        'test://private-commonjs-resource',
        { mimeType: 'text/plain' },
        mcpExtensionErrorBoundary.resource(async () => {
          throw new Error('PRIVATE_COMMONJS_RESOURCE_FAILURE');
        }),
      );
    },
  });
  const verifier = createAuth0Verifier({
    issuer: authority.issuer,
    audience: authority.audience,
    jwksUri: authority.jwksUri,
    jwks: { fetch: authority.fetch, cooldownMs: 0 },
  });
  const running = await serveNode(definition, {
    dependencies: () => ({}),
    authenticate: createAuth0BearerGate({
      verifier,
      resourceMetadataUrl: getAuth0ProtectedResourceMetadataUrl(authority.audience),
    }),
    principalFromAuthInfo,
    discovery: createAuth0ProtectedResourceHandler({
      issuer: authority.issuer,
      resourceServerUrl: authority.audience,
      scopesSupported: ['example:read'],
    }),
  });
  const token = await authority.sign({ scope: 'example:read' });
  const client = new Client({ name: 'commonjs-consumer', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', running.url), {
        requestInit: { headers: { authorization: 'Bearer ' + token } },
      }),
    );
    const result = await client.callTool({ name: 'commonjs-read', arguments: {} });
    if (result.isError || result.structuredContent?.value !== 'commonjs-ready') {
      throw new Error('CommonJS authenticated tool call failed');
    }
    const appResult = await client.readResource({ uri: appResource.uri });
    if (appResult.contents[0]?.text !== '<html>commonjs-app-ready</html>') {
      throw new Error('CommonJS scoped MCP Apps resource failed');
    }
    try {
      await client.readResource({ uri: 'test://private-commonjs-resource' });
      throw new Error('CommonJS private resource unexpectedly succeeded');
    } catch (error) {
      if (error?.code !== -32603 || error?.message !== 'The MCP request could not be completed') {
        throw error;
      }
      if (
        String(error).includes('PRIVATE_COMMONJS_RESOURCE_FAILURE') ||
        error?.data !== undefined ||
        error?.cause !== undefined
      ) {
        throw new Error('CommonJS extension boundary leaked private failure data');
      }
    }
    console.log('packed CommonJS consumer passed authenticated smoke checks');
  } finally {
    await client.close();
    await running.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`,
  );
  await installOffline(workspace);
  await run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: workspace });
  await run(process.execPath, ['smoke.mjs'], { cwd: workspace });
  await run(process.execPath, ['smoke.cjs'], { cwd: workspace });
} finally {
  await rm(workspace, { recursive: true, force: true });
}

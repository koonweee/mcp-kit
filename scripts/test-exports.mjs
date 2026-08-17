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
        dependencies: {
          '@koonweee/mcp-kit': fileDependency(tarball),
          '@modelcontextprotocol/server': '2.0.0',
          zod: '4.4.3',
        },
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
  import('@koonweee/mcp-kit'),
  import('@koonweee/mcp-kit/node'),
  import('@koonweee/mcp-kit/auth0'),
  import('@koonweee/mcp-kit/test'),
]);
for (const [index, surface] of surfaces.entries()) {
  if (Object.keys(surface).length === 0) throw new Error('empty public subpath ' + index);
}
for (const privatePath of [
  '@koonweee/mcp-kit/cloudflare',
  '@koonweee/mcp-kit/dist/core/definition.js',
]) {
  try {
    await import(privatePath);
    throw new Error('private path unexpectedly exported: ' + privatePath);
  } catch (error) {
    if (String(error).includes('unexpectedly exported')) throw error;
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
  }
}
if (typeof surfaces[0].defineAppResource !== 'function') throw new Error('MCP Apps helper missing');
if (typeof surfaces[3].createTestJwtAuthority !== 'function') throw new Error('test helper missing');
console.log('all four public subpaths imported from the packed artifact');
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
];
for (const [index, surface] of surfaces.entries()) {
  if (Object.keys(surface).length === 0) throw new Error('empty CommonJS public subpath ' + index);
}
if (typeof surfaces[0].defineAppResource !== 'function') throw new Error('CommonJS MCP Apps helper missing');
if (typeof surfaces[3].createTestJwtAuthority !== 'function') throw new Error('CommonJS test helper missing');
console.log('all four CommonJS public subpaths required from the packed artifact');
`,
  );
  await writeFile(
    join(workspace, 'index.ts'),
    `
import { MCP_APP_RESOURCE_MIME_TYPE, defineAppResource, defineServer, defineTool, mcpExtensionErrorBoundary, validateMcpApps, type McpAppResourceDefinition, type McpClientProtocolEra, type McpLogRecord, type McpPrincipal } from '@koonweee/mcp-kit';
import { createNodeMcpHandler, type NodeMcpHandler } from '@koonweee/mcp-kit/node';
import { createAuth0Verifier, type Auth0VerifierOptions } from '@koonweee/mcp-kit/auth0';
import { connectInMemory, createTestPrincipal, type InMemoryMcpClient } from '@koonweee/mcp-kit/test';
import { ResourceTemplate, inputRequired, type ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

const principal: McpPrincipal = createTestPrincipal();
const logRecord: McpLogRecord = { event: 'tool.started', requestId: 'opaque', toolName: 'typed' };
// @ts-expect-error Principal identity is deliberately absent from packed log record declarations.
logRecord.subject;
const authOptions = {} as Auth0VerifierOptions;
const verifier = createAuth0Verifier(authOptions);
const resourceCallback = mcpExtensionErrorBoundary.resource((uri, sdkContext) => {
  const officialContext: ServerContext = sdkContext;
  void officialContext;
  return { contents: [{ uri: uri.href, text: 'typed resource' }] };
});
const resourceTemplateCallback = mcpExtensionErrorBoundary.resourceTemplate(
  (uri, variables, sdkContext) => {
    const officialContext: ServerContext = sdkContext;
    void officialContext;
    return { contents: [{ uri: uri.href, text: String(variables['name']) }] };
  },
);
const promptSchema = z.object({ topic: z.string() });
const promptCallback = mcpExtensionErrorBoundary.prompt(promptSchema, ({ topic }, sdkContext) => {
  const officialContext: ServerContext = sdkContext;
  void officialContext;
  return { messages: [{ role: 'user', content: { type: 'text', text: topic } }] };
});
const listCallback = mcpExtensionErrorBoundary.listResources(() => ({ resources: [] }));
const completeCallback = mcpExtensionErrorBoundary.completeResourceTemplate(async (value) => [value]);
const template = new ResourceTemplate('test://{name}', {
  list: listCallback,
  complete: { name: completeCallback },
});
const tool = defineTool<Record<string, never>>();
const outputSchema = z.object({ value: z.string() });
const appResource: McpAppResourceDefinition<Record<string, never>> = defineAppResource<Record<string, never>>()({
  name: 'typed-app',
  uri: 'ui://typed/app-v1.html',
  ui: { domain: 'https://widgets.example.com', prefersBorder: true },
  html: '<!doctype html><html><body>typed</body></html>',
});
const typedTool = tool({
  name: 'typed',
  description: 'Packed declaration inference fixture',
  inputSchema: z.object({}),
  outputSchema,
  _meta: { 'example.dev/category': 'types' },
  ui: { resourceUri: appResource.uri },
  requiredScopes: [],
  risk: { kind: 'read' },
  handler: (_input, context) => {
    const era: McpClientProtocolEra = context.client.protocolEra;
    const supportsForm: boolean = context.client.inputRequired.formElicitation;
    void [era, supportsForm];
    return {
      content: [{ type: 'text', text: 'typed' }],
      structuredContent: { value: 'typed' },
    };
  },
});
const multiRoundTool = tool({
  name: 'multi-round',
  description: 'Packed SDK context and input-required fixture',
  inputSchema: z.object({ outcome: z.enum(['success', 'error', 'input-required']) }),
  outputSchema,
  requiredScopes: [],
  risk: { kind: 'read' },
  handler: ({ outcome }, _context, sdkContext) => {
    const officialContext: ServerContext = sdkContext;
    void officialContext;
    if (outcome === 'error') {
      return { content: [{ type: 'text', text: 'error' }], isError: true };
    }
    if (outcome === 'input-required') return inputRequired({ requestState: 'round-1' });
    return {
      content: [{ type: 'text', text: 'typed' }],
      structuredContent: { value: 'typed' },
    };
  },
});
tool({
  name: 'invalid-typed',
  description: 'Packed declaration rejection fixture',
  inputSchema: z.object({}),
  outputSchema,
  requiredScopes: [],
  risk: { kind: 'read' },
  handler: () => ({
    content: [{ type: 'text', text: 'invalid' }],
    // @ts-expect-error Packed declarations must reject mismatched structured content.
    structuredContent: { value: 123 },
  }),
});
const definition = defineServer<Record<string, never>>()({
  name: 'types',
  version: '1.0.0',
  apps: { resources: [appResource] },
  tools: [typedTool, multiRoundTool],
});
validateMcpApps(definition, { profile: 'openai-submission' });
const appMimeType: typeof MCP_APP_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
const handler: NodeMcpHandler = createNodeMcpHandler(definition, { dependencies: () => ({}) });
const connection: Promise<InMemoryMcpClient> = connectInMemory(
  definition,
  { requestId: 'types', principal, logger: { log() {}, error() {} }, dependencies: {} },
);
void [tool, typedTool, multiRoundTool, appResource, appMimeType, verifier, handler, connection, logRecord, resourceCallback, resourceTemplateCallback, promptCallback, template];
`,
  );
  await writeFile(
    join(workspace, 'index.cts'),
    `
import { MCP_APP_RESOURCE_MIME_TYPE, defineAppResource, defineServer, defineTool, mcpExtensionErrorBoundary, validateMcpApps, type McpClientProtocolEra, type McpLogRecord, type McpPrincipal } from '@koonweee/mcp-kit';
import { createNodeMcpHandler, type NodeMcpHandler } from '@koonweee/mcp-kit/node';
import { createAuth0Verifier, type Auth0VerifierOptions } from '@koonweee/mcp-kit/auth0';
import { createTestJwtAuthority, createTestPrincipal } from '@koonweee/mcp-kit/test';
import { ResourceTemplate, inputRequired, type ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

const principal: McpPrincipal = createTestPrincipal();
const logRecord: McpLogRecord = { event: 'tool.started', requestId: 'opaque', toolName: 'typed' };
// @ts-expect-error Principal identity is deliberately absent from packed log record declarations.
logRecord.subject;
const verifier = createAuth0Verifier({} as Auth0VerifierOptions);
const resourceCallback = mcpExtensionErrorBoundary.resource((uri, sdkContext) => {
  const officialContext: ServerContext = sdkContext;
  void officialContext;
  return { contents: [{ uri: uri.href, text: 'typed resource' }] };
});
const resourceTemplateCallback = mcpExtensionErrorBoundary.resourceTemplate(
  (uri, variables, sdkContext) => {
    const officialContext: ServerContext = sdkContext;
    void officialContext;
    return { contents: [{ uri: uri.href, text: String(variables['name']) }] };
  },
);
const promptSchema = z.object({ topic: z.string() });
const promptCallback = mcpExtensionErrorBoundary.prompt(promptSchema, ({ topic }, sdkContext) => {
  const officialContext: ServerContext = sdkContext;
  void officialContext;
  return { messages: [{ role: 'user', content: { type: 'text', text: topic } }] };
});
const listCallback = mcpExtensionErrorBoundary.listResources(() => ({ resources: [] }));
const completeCallback = mcpExtensionErrorBoundary.completeResourceTemplate(async (value) => [value]);
const template = new ResourceTemplate('test://{name}', {
  list: listCallback,
  complete: { name: completeCallback },
});
const outputSchema = z.object({ value: z.string() });
const appResource = defineAppResource<Record<string, never>>()({
  name: 'commonjs-app',
  uri: 'ui://commonjs/app-v1.html',
  ui: { domain: 'https://widgets.example.com' },
  html: '<!doctype html><html><body>commonjs</body></html>',
});
const tool = defineTool<Record<string, never>>()({
  name: 'commonjs-types',
  description: 'CommonJS declaration inference fixture',
  inputSchema: z.object({ requireInput: z.boolean() }),
  outputSchema,
  _meta: { 'example.dev/module': 'commonjs' },
  ui: { resourceUri: appResource.uri },
  requiredScopes: [],
  risk: { kind: 'read' },
  handler: ({ requireInput }, context, sdkContext) => {
    const officialContext: ServerContext = sdkContext;
    const era: McpClientProtocolEra = context.client.protocolEra;
    const supportsForm: boolean = context.client.inputRequired.formElicitation;
    void [officialContext, era, supportsForm];
    if (requireInput) return inputRequired({ requestState: 'commonjs-round-1' });
    return {
      content: [{ type: 'text', text: 'typed' }],
      structuredContent: { value: 'typed' },
    };
  },
});
const definition = defineServer<Record<string, never>>()({
  name: 'commonjs-types',
  version: '1.0.0',
  apps: { resources: [appResource] },
  tools: [tool],
});
validateMcpApps(definition, { profile: 'openai-submission' });
const appMimeType: typeof MCP_APP_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
const handler: NodeMcpHandler = createNodeMcpHandler(definition, { dependencies: () => ({}) });
const authority = createTestJwtAuthority();
void [principal, verifier, handler, authority, appResource, appMimeType, logRecord, resourceCallback, resourceTemplateCallback, promptCallback, template];
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
        include: ['index.ts', 'index.cts'],
      },
      null,
      2,
    ),
  );
  await installOffline(workspace);
  await run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: workspace });
  await run(process.execPath, ['index.mjs'], { cwd: workspace });
  await run(process.execPath, ['index.cjs'], { cwd: workspace });
} finally {
  await rm(workspace, { recursive: true, force: true });
}

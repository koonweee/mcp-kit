import { pathToFileURL } from 'node:url';
import { z } from 'zod/v4';
import {
  createAuth0BearerGate,
  createAuth0ProtectedResourceHandler,
  createAuth0Verifier,
  getAuth0ProtectedResourceMetadataUrl,
  principalFromAuthInfo,
  type Auth0JwksOptions,
} from '@koonweee/mcp-kit/auth0';
import { defineAppResource, defineServer, defineTool } from '@koonweee/mcp-kit';
import { serveNode, type RunningNodeMcpServer } from '@koonweee/mcp-kit/node';

interface FakeBackend {
  read(): string;
  write(value: string): void;
}

function createFakeBackend(): FakeBackend {
  let value = 'ready';
  return {
    read: () => value,
    write(next) {
      value = next;
    },
  };
}

const tool = defineTool<{ readonly backend: FakeBackend }>();
const statusOutputSchema = z.object({ status: z.string() });
const statusApp = defineAppResource<{ readonly backend: FakeBackend }>()({
  name: 'status-card',
  uri: 'ui://status/card-v1.html',
  title: 'Backend status card',
  description: 'Neutral MCP Apps resource used by the basic Node example.',
  ui: {
    domain: 'https://widgets.example.com',
    prefersBorder: true,
  },
  html: '<!doctype html><html lang="en"><body><main>Status results are also available through the tool text fallback.</main></body></html>',
});

export const exampleDefinition = defineServer<{ readonly backend: FakeBackend }>()({
  name: 'mcp-kit-basic-node',
  version: '1.0.0',
  instructions: 'A neutral example; replace its fake backend in the consuming service.',
  apps: { resources: [statusApp] },
  tools: [
    tool({
      name: 'read-status',
      description: 'Read the fake backend status',
      inputSchema: z.object({}),
      outputSchema: statusOutputSchema,
      _meta: { 'example.dev/category': 'status' },
      ui: { resourceUri: statusApp.uri },
      requiredScopes: ['example:read'],
      risk: { kind: 'read' },
      handler(_input, context) {
        const status = context.dependencies.backend.read();
        return { content: [{ type: 'text', text: status }], structuredContent: { status } };
      },
    }),
    tool({
      name: 'write-status',
      description: 'Change the fake backend status',
      inputSchema: z.object({ value: z.string().min(1).max(100) }),
      requiredScopes: ['example:write'],
      risk: { kind: 'mutating', idempotent: true },
      handler({ value }, context) {
        context.dependencies.backend.write(value);
        return { content: [{ type: 'text', text: 'updated' }] };
      },
    }),
  ],
});

export interface StartExampleOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri?: string;
  readonly jwks?: Auth0JwksOptions;
  readonly hostname?: string;
  readonly port?: number;
}

/** Starts the example with environment and service dependencies supplied by the consumer. */
export function startExample(options: StartExampleOptions): Promise<RunningNodeMcpServer> {
  const backend = createFakeBackend();
  const verifier = createAuth0Verifier({
    issuer: options.issuer,
    audience: options.audience,
    ...(options.jwksUri ? { jwksUri: options.jwksUri } : {}),
    ...(options.jwks ? { jwks: options.jwks } : {}),
  });
  return serveNode(exampleDefinition, {
    ...(options.hostname ? { hostname: options.hostname } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    dependencies: () => ({ backend }),
    authenticate: createAuth0BearerGate({
      verifier,
      resourceMetadataUrl: getAuth0ProtectedResourceMetadataUrl(options.audience),
    }),
    principalFromAuthInfo,
    discovery: createAuth0ProtectedResourceHandler({
      issuer: options.issuer,
      resourceServerUrl: options.audience,
      resourceName: 'MCP kit basic Node example',
      scopesSupported: ['example:read', 'example:write'],
    }),
  });
}

async function main(): Promise<void> {
  const issuer = process.env['AUTH0_ISSUER'];
  const audience = process.env['AUTH0_AUDIENCE'];
  if (!issuer || !audience) throw new Error('AUTH0_ISSUER and AUTH0_AUDIENCE are required');
  const running = await startExample({
    issuer,
    audience,
    ...(process.env['AUTH0_JWKS_URI'] ? { jwksUri: process.env['AUTH0_JWKS_URI'] } : {}),
    hostname: process.env['HOST'] ?? '127.0.0.1',
    port: Number(process.env['PORT'] ?? '3000'),
  });
  console.info(`Example MCP server listening at ${running.url.href}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void running.close());
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

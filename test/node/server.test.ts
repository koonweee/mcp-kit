import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { request as httpRequest } from 'node:http';
import { z } from 'zod/v4';
import {
  createAuth0BearerGate,
  createAuth0Verifier,
  principalFromAuthInfo,
} from '../../src/auth0/index.js';
import { defineServer, defineTool, silentLogger } from '../../src/index.js';
import { createNodeMcpHandler, serveNode } from '../../src/node/index.js';
import { createTestJwtAuthority } from '../../src/test/index.js';

interface Dependencies {
  readonly instance: number;
}

function testDefinition(
  options: {
    wait?: () => Promise<void>;
    started?: () => void;
    requiredScopes?: readonly string[];
  } = {},
) {
  return defineServer<Dependencies>()({
    name: 'node-test',
    version: '1.0.0',
    tools: [
      defineTool<Dependencies>()({
        name: 'whoami',
        description: 'Return request identity',
        inputSchema: z.object({}),
        requiredScopes: options.requiredScopes ?? [],
        risk: { kind: 'read' },
        async handler(_input, context) {
          options.started?.();
          await options.wait?.();
          return {
            content: [
              {
                type: 'text',
                text: `${context.principal?.subject ?? 'anonymous'}:${context.dependencies.instance}:${context.requestId}`,
              },
            ],
          };
        },
      }),
    ],
  });
}

function clientFor(url: URL, modern: boolean, authorization?: string) {
  const client = new Client(
    { name: modern ? 'modern-test' : 'legacy-test', version: '1.0.0' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : undefined,
  );
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', url), {
    ...(authorization ? { requestInit: { headers: { authorization } } } : {}),
  });
  return { client, transport };
}

function rawStatus(url: URL, headers: Record<string, string>): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      response.resume();
      response.once('end', () => {
        resolve(response.statusCode);
      });
    });
    request.once('error', reject);
    request.end();
  });
}

describe('stateless Node adapter', () => {
  it.each([
    ['legacy', false],
    ['modern', true],
  ] as const)(
    'initializes, lists, and calls tools with the official %s client',
    async (_name, modern) => {
      let instances = 0;
      const running = await serveNode(testDefinition(), {
        dependencies: () => ({ instance: ++instances }),
        logger: silentLogger,
      });
      const { client, transport } = clientFor(running.url, modern);
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe(modern ? 'modern' : 'legacy');
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['whoami']);
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.content[0]).toMatchObject({ type: 'text' });
      expect(result.isError).not.toBe(true);
      expect(transport.sessionId).toBeUndefined();
      expect(instances).toBeGreaterThanOrEqual(3);
      await client.close();
      await running.close();
    },
  );

  it('authenticates calls, keeps health public, and isolates concurrent request contexts', async () => {
    const authority = await createTestJwtAuthority();
    const verifier = createAuth0Verifier({
      issuer: authority.issuer,
      audience: authority.audience,
      jwksUri: authority.jwksUri,
      jwks: { fetch: authority.fetch },
    });
    let instances = 0;
    const loggedRequestIds = new Set<string>();
    const running = await serveNode(testDefinition({ requiredScopes: ['mcp:read'] }), {
      dependencies: () => ({ instance: ++instances }),
      logger: (factoryContext) => ({
        log(record) {
          expect(record.requestId).toBe(factoryContext.requestId);
          loggedRequestIds.add(record.requestId);
        },
        error(record) {
          expect(record.requestId).toBe(factoryContext.requestId);
          loggedRequestIds.add(record.requestId);
        },
      }),
      authenticate: createAuth0BearerGate({ verifier }),
      principalFromAuthInfo,
    });
    const health = await fetch(new URL('/healthz', running.url));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });

    const denied = await fetch(new URL('/mcp', running.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(denied.status).toBe(401);

    const firstConnection = clientFor(
      running.url,
      true,
      `Bearer ${await authority.sign({ subject: 'user-a', scope: 'mcp:read' })}`,
    );
    const secondConnection = clientFor(
      running.url,
      true,
      `Bearer ${await authority.sign({ subject: 'user-b', scope: 'mcp:read' })}`,
    );
    await Promise.all([
      firstConnection.client.connect(firstConnection.transport),
      secondConnection.client.connect(secondConnection.transport),
    ]);
    const [first, second] = await Promise.all([
      firstConnection.client.callTool({ name: 'whoami', arguments: {} }),
      secondConnection.client.callTool({ name: 'whoami', arguments: {} }),
    ]);
    const firstText = (first.content[0] as { text: string }).text;
    const secondText = (second.content[0] as { text: string }).text;
    const [firstSubject, firstInstance, firstRequestId] = firstText.split(':');
    const [secondSubject, secondInstance, secondRequestId] = secondText.split(':');
    expect([firstSubject, secondSubject]).toEqual(['user-a', 'user-b']);
    expect(firstInstance).not.toBe(secondInstance);
    expect(firstRequestId).not.toBe(secondRequestId);
    expect(loggedRequestIds).toEqual(new Set([firstRequestId, secondRequestId]));
    await Promise.all([firstConnection.client.close(), secondConnection.client.close()]);
    await running.close();
  });

  it('enforces routing, Host/Origin protections, content type, and body bounds', async () => {
    const running = await serveNode(testDefinition(), {
      dependencies: () => ({ instance: 1 }),
      logger: silentLogger,
      maxBodyBytes: 32,
    });
    expect((await fetch(new URL('/wrong', running.url))).status).toBe(404);
    expect(await rawStatus(new URL('/healthz', running.url), { host: 'evil.example' })).toBe(403);
    expect(
      (
        await fetch(new URL('/healthz', running.url), {
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    const unsupported = await fetch(new URL('/mcp', running.url), {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toMatchObject({ error: { code: -32_000 } });
    expect(
      (
        await fetch(new URL('/mcp', running.url), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ payload: 'x'.repeat(100) }),
        })
      ).status,
    ).toBe(413);
    const invalid = await fetch(new URL('/mcp', running.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: -32_700 } });
    await running.close();
  });

  it('rejects unsafe bounds at construction', () => {
    expect(() =>
      createNodeMcpHandler(testDefinition(), {
        dependencies: () => ({ instance: 1 }),
        maxBodyBytes: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/positive safe integer/u);
    expect(() =>
      createNodeMcpHandler(testDefinition(), {
        dependencies: () => ({ instance: 1 }),
        mcpPath: '/same',
        healthPath: '/same',
      }),
    ).toThrow(/distinct/u);
  });

  it('waits for an active request before graceful shutdown completes', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const running = await serveNode(testDefinition({ wait: () => wait, started: startedResolve }), {
      dependencies: () => ({ instance: 1 }),
      logger: silentLogger,
    });
    const { client, transport } = clientFor(running.url, true);
    await client.connect(transport);
    const call = client.callTool({ name: 'whoami', arguments: {} });
    await started;
    let closed = false;
    const closing = running.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);
    release();
    expect((await call).isError).not.toBe(true);
    await closing;
    await client.close();
  });
});

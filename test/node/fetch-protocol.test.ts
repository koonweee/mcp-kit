import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import {
  createMcpServer,
  createRequestContext,
  defineServer,
  defineTool,
  silentLogger,
} from '../../src/index.js';

const definition = defineServer<{ readonly id: number }>()({
  name: 'fetch-test',
  version: '1.0.0',
  tools: [
    defineTool<{ readonly id: number }>()({
      name: 'id',
      description: 'Return request-local id',
      inputSchema: z.object({}),
      requiredScopes: [],
      risk: { kind: 'read' },
      handler(_input, context) {
        return { content: [{ type: 'text', text: String(context.dependencies.id) }] };
      },
    }),
  ],
});

describe('SDK v2 current and legacy fetch behavior', () => {
  it.each([
    ['legacy', false],
    ['modern', true],
  ] as const)('uses a fresh server for %s stateless requests', async (_name, modern) => {
    let factoryCalls = 0;
    const handler = createMcpHandler(() => {
      factoryCalls += 1;
      return createMcpServer(
        definition,
        createRequestContext({
          requestId: `request-${factoryCalls}`,
          logger: silentLogger,
          dependencies: { id: factoryCalls },
        }),
      );
    });
    const client = new Client(
      { name: 'fetch-client', version: '1.0.0' },
      modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : undefined,
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    });
    await client.connect(transport);
    await client.listTools();
    await client.callTool({ name: 'id', arguments: {} });
    expect(factoryCalls).toBeGreaterThanOrEqual(modern ? 3 : 4);
    expect(client.getProtocolEra()).toBe(modern ? 'modern' : 'legacy');
    expect(transport.sessionId).toBeUndefined();
    await client.close();
    await handler.close();
  });
});

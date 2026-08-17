import {
  Client,
  StreamableHTTPClientTransport,
  specTypeSchemas,
  withInputRequired,
} from '@modelcontextprotocol/client';
import {
  createMcpHandler,
  inputRequired,
  type InputRequiredResult,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import {
  createMcpServer,
  createRequestContext,
  defineServer,
  defineTool,
  silentLogger,
  type McpClientSupport,
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

  it('passes an official input-required result through a modern tool call', async () => {
    let receivedSdkContext: ServerContext | undefined;
    const requestedInput: InputRequiredResult = inputRequired({ requestState: 'round-1' });
    const multiRoundDefinition = defineServer<Record<string, never>>()({
      name: 'modern-input-test',
      version: '1.0.0',
      tools: [
        defineTool<Record<string, never>>()({
          name: 'request-input',
          description: 'Request another input round',
          inputSchema: z.object({}),
          outputSchema: z.object({ done: z.boolean() }),
          requiredScopes: [],
          risk: { kind: 'read' },
          handler(_input, _context, sdkContext) {
            receivedSdkContext = sdkContext;
            return requestedInput;
          },
        }),
      ],
    });
    const handler = createMcpHandler(() =>
      createMcpServer(
        multiRoundDefinition,
        createRequestContext({
          requestId: 'request-modern-input',
          logger: silentLogger,
          dependencies: {},
        }),
      ),
    );
    const client = new Client(
      { name: 'modern-input-client', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    });
    await client.connect(transport);

    const result = await client.request(
      { method: 'tools/call', params: { name: 'request-input', arguments: {} } },
      withInputRequired(specTypeSchemas.CallToolResult),
      { allowInputRequired: true },
    );
    expect(result).toMatchObject(requestedInput);
    expect(receivedSdkContext?.mcpReq.method).toBe('tools/call');
    expect(receivedSdkContext?.mcpReq.signal).toBeInstanceOf(AbortSignal);
    await client.close();
    await handler.close();
  });

  it.each([
    ['form-capable', { elicitation: { form: {} } }, true, false],
    ['url-only', { elicitation: { url: {} } }, false, true],
    ['incapable', {}, false, false],
  ] as const)(
    'reports a modern form-elicitation client as %s',
    async (_label, capabilities, formElicitation, urlElicitation) => {
      let support: McpClientSupport | undefined;
      const supportDefinition = defineServer<Record<string, never>>()({
        name: 'modern-support-test',
        version: '1.0.0',
        tools: [
          defineTool<Record<string, never>>()({
            name: 'inspect-support',
            description: 'Inspect modern input-required support',
            inputSchema: z.object({}),
            requiredScopes: [],
            risk: { kind: 'read' },
            handler(_input, context) {
              support = context.client;
              return { content: [{ type: 'text', text: 'inspected' }] };
            },
          }),
        ],
      });
      const handler = createMcpHandler(() =>
        createMcpServer(
          supportDefinition,
          createRequestContext({
            requestId: 'request-modern-support',
            logger: silentLogger,
            dependencies: {},
          }),
        ),
      );
      const client = new Client(
        { name: 'modern-support-client', version: '1.0.0' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } }, capabilities },
      );
      const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      });
      try {
        await client.connect(transport);
        await client.callTool({ name: 'inspect-support', arguments: {} });
        expect(support).toEqual({
          protocolEra: 'modern',
          inputRequired: { formElicitation, urlElicitation },
        });
      } finally {
        await client.close();
        await handler.close();
      }
    },
  );
});

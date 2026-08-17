import {
  inputRequired,
  type InputRequiredResult,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { expectTypeOf } from 'vitest';
import { z } from 'zod/v4';
import {
  McpPublicError,
  createRequestContext,
  defineServer,
  defineTool,
  riskToAnnotations,
  silentLogger,
  type McpLogRecord,
  type McpLogger,
  type McpClientSupport,
  type McpToolRequestContext,
  type McpToolResult,
} from '../../src/index.js';
import { connectInMemory, createTestPrincipal, invokeTool } from '../../src/test/index.js';

interface Dependencies {
  readonly prefix: string;
}

const echoOutputSchema = z.object({ text: z.string() });

const echoTool = defineTool<Dependencies>()({
  name: 'echo',
  description: 'Echo a value',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: echoOutputSchema,
  _meta: { 'example.dev/presentation': { kind: 'echo' } },
  requiredScopes: ['echo:read'],
  risk: { kind: 'read' },
  handler(input, context) {
    expectTypeOf(input).toEqualTypeOf<{ value: string }>();
    expectTypeOf(context.dependencies).toEqualTypeOf<Dependencies>();
    const text = `${context.dependencies.prefix}${input.value}`;
    return { content: [{ type: 'text', text }], structuredContent: { text } };
  },
});

const definition = defineServer<Dependencies>()({
  name: 'core-test',
  version: '1.0.0',
  tools: [echoTool],
});

describe('portable definitions', () => {
  it('infers inputs and dependencies and executes through the official in-memory client', async () => {
    const connected = await connectInMemory(
      definition,
      createRequestContext({
        requestId: 'request-1',
        principal: createTestPrincipal('user-1', ['echo:read']),
        logger: silentLogger,
        dependencies: { prefix: '>' },
      }),
    );

    const listed = await connected.client.listTools();
    expect(listed.tools).toHaveLength(1);
    expect(listed.tools[0]?.outputSchema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    });
    expect(listed.tools[0]?._meta).toEqual({
      'example.dev/presentation': { kind: 'echo' },
    });
    expect(listed.tools[0]?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const result = await connected.client.callTool({ name: 'echo', arguments: { value: 'hello' } });
    expect(result).toMatchObject({
      content: [{ type: 'text', text: '>hello' }],
      structuredContent: { text: '>hello' },
    });
    await connected.close();
  });

  it('keeps tools without output schemas or metadata compatible', async () => {
    const plainTool = defineTool<Dependencies>()({
      name: 'plain',
      description: 'Return plain content',
      inputSchema: z.object({}),
      requiredScopes: [],
      risk: { kind: 'read' },
      handler() {
        return { content: [{ type: 'text', text: 'plain' }] };
      },
    });
    const connected = await connectInMemory(
      defineServer<Dependencies>()({
        name: 'compatibility-test',
        version: '1.0.0',
        tools: [plainTool],
      }),
      createRequestContext({
        requestId: 'request-compatibility',
        logger: silentLogger,
        dependencies: { prefix: '' },
      }),
    );

    const listed = await connected.client.listTools();
    expect(listed.tools[0]?.outputSchema).toBeUndefined();
    expect(listed.tools[0]?._meta).toBeUndefined();
    expect(await connected.client.callTool({ name: 'plain', arguments: {} })).toMatchObject({
      content: [{ type: 'text', text: 'plain' }],
    });
    await connected.close();
  });

  it('passes the official SDK context and input-required results through unchanged', async () => {
    let receivedSdkContext: ServerContext | undefined;
    const requestedInput: InputRequiredResult = inputRequired({ requestState: 'round-1' });
    const multiRoundTool = defineTool<Dependencies>()({
      name: 'multi-round',
      description: 'Exercise SDK-native multi-round input',
      inputSchema: z.object({ outcome: z.enum(['success', 'error', 'input-required']) }),
      outputSchema: echoOutputSchema,
      requiredScopes: ['echo:read'],
      risk: { kind: 'read' },
      handler({ outcome }, context, sdkContext) {
        expectTypeOf(sdkContext).toEqualTypeOf<ServerContext>();
        receivedSdkContext = sdkContext;
        if (outcome === 'error') {
          return { content: [{ type: 'text', text: 'safe error' }], isError: true };
        }
        if (outcome === 'input-required') return requestedInput;
        const text = `${context.dependencies.prefix}success`;
        return { content: [{ type: 'text', text }], structuredContent: { text } };
      },
    });
    const requestContext = createRequestContext({
      requestId: 'request-multi-round',
      principal: createTestPrincipal('user-multi-round', ['echo:read']),
      logger: silentLogger,
      dependencies: { prefix: '>' },
    });
    const connected = await connectInMemory(
      defineServer<Dependencies>()({
        name: 'multi-round-test',
        version: '1.0.0',
        tools: [multiRoundTool],
      }),
      requestContext,
    );

    expect(
      await connected.client.callTool({
        name: 'multi-round',
        arguments: { outcome: 'success' },
      }),
    ).toMatchObject({
      content: [{ type: 'text', text: '>success' }],
      structuredContent: { text: '>success' },
    });
    expect(receivedSdkContext?.mcpReq.method).toBe('tools/call');
    expect(receivedSdkContext?.mcpReq.signal).toBeInstanceOf(AbortSignal);

    const sdkContext = receivedSdkContext;
    expect(sdkContext).toBeDefined();
    const errorResult = await invokeTool(
      multiRoundTool,
      { outcome: 'error' },
      requestContext,
      sdkContext,
    );
    expect(errorResult).toMatchObject({ isError: true, content: [{ text: 'safe error' }] });
    const inputRequiredResult = await invokeTool(
      multiRoundTool,
      { outcome: 'input-required' },
      requestContext,
      sdkContext,
    );
    expect(inputRequiredResult).toBe(requestedInput);
    expectTypeOf(inputRequiredResult).toEqualTypeOf<McpToolResult<typeof echoOutputSchema>>();
    expect(receivedSdkContext).toBe(sdkContext);
    await connected.close();
  });

  it('exposes typed form-input support for legacy clients', async () => {
    const inspect = async (clientOptions: Parameters<typeof connectInMemory>[2]) => {
      let support: McpClientSupport | undefined;
      const supportTool = defineTool<Dependencies>()({
        name: 'client-support',
        description: 'Inspect the kit-owned client support signal',
        inputSchema: z.object({}),
        requiredScopes: [],
        risk: { kind: 'read' },
        handler(_input, context, sdkContext) {
          expectTypeOf(context).toEqualTypeOf<McpToolRequestContext<Dependencies>>();
          expectTypeOf(sdkContext).toEqualTypeOf<ServerContext>();
          support = context.client;
          return { content: [{ type: 'text', text: 'inspected' }] };
        },
      });
      const connected = await connectInMemory(
        defineServer<Dependencies>()({
          name: 'client-support-test',
          version: '1.0.0',
          tools: [supportTool],
        }),
        createRequestContext({
          requestId: 'request-client-support',
          logger: silentLogger,
          dependencies: { prefix: '' },
        }),
        clientOptions,
      );
      try {
        await connected.client.callTool({ name: 'client-support', arguments: {} });
        return support;
      } finally {
        await connected.close();
      }
    };

    await expect(inspect({ capabilities: { elicitation: {} } })).resolves.toEqual({
      protocolEra: 'legacy',
      inputRequired: { formElicitation: true, urlElicitation: false },
    });
    await expect(inspect({ capabilities: { elicitation: { url: {} } } })).resolves.toEqual({
      protocolEra: 'legacy',
      inputRequired: { formElicitation: false, urlElicitation: true },
    });
    await expect(inspect({ capabilities: {} })).resolves.toEqual({
      protocolEra: 'legacy',
      inputRequired: { formElicitation: false, urlElicitation: false },
    });
  });

  it('denies missing scopes before the service handler runs', async () => {
    let called = false;
    const protectedTool = defineTool<Dependencies>()({
      ...echoTool,
      handler() {
        called = true;
        return {
          content: [{ type: 'text', text: 'unsafe' }],
          structuredContent: { text: 'unsafe' },
        };
      },
    });
    const result = await invokeTool(
      protectedTool,
      { value: 'x' },
      createRequestContext({
        requestId: 'request-2',
        principal: createTestPrincipal('user-2'),
        logger: silentLogger,
        dependencies: { prefix: '' },
      }),
    );
    expect(called).toBe(false);
    expect(result).toMatchObject({ isError: true, content: [{ text: 'Insufficient scope' }] });
  });

  it('lets the SDK reject invalid Zod inputs without calling the handler', async () => {
    let called = false;
    const checked = defineServer<Dependencies>()({
      ...definition,
      tools: [
        defineTool<Dependencies>()({
          ...echoTool,
          handler() {
            called = true;
            return {
              content: [{ type: 'text', text: 'called' }],
              structuredContent: { text: 'called' },
            };
          },
        }),
      ],
    });
    const connected = await connectInMemory(
      checked,
      createRequestContext({
        requestId: 'request-3',
        principal: createTestPrincipal('user-3', ['echo:read']),
        logger: silentLogger,
        dependencies: { prefix: '' },
      }),
    );
    const result = await connected.client.callTool({ name: 'echo', arguments: { value: 123 } });
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
    await connected.close();
  });

  it('sanitizes internal failures and never emits principal identity or claims', async () => {
    const records: McpLogRecord[] = [];
    const causes: unknown[] = [];
    const logger: McpLogger = {
      log: (record) => records.push(record),
      error(record, cause) {
        records.push(record);
        causes.push(cause);
      },
    };
    const failing = defineTool<Dependencies>()({
      ...echoTool,
      handler() {
        throw new McpPublicError('backend_failed', 'Safe failure', {
          cause: new Error('secret backend token'),
        });
      },
    });
    const result = await invokeTool(
      failing,
      { value: 'secret input' },
      createRequestContext({
        requestId: 'request-4',
        principal: {
          subject: 'secret-auth0-subject',
          clientId: 'secret-client-id',
          scopes: new Set(['echo:read']),
          claims: {
            email: 'secret@example.test',
            permissions: ['secret:permission'],
          },
        },
        logger,
        dependencies: { prefix: 'secret prefix' },
      }),
    );
    expect(result).toMatchObject({ isError: true, content: [{ text: 'Safe failure' }] });
    await invokeTool(
      echoTool,
      { value: 'ok' },
      createRequestContext({
        requestId: 'request-4-success',
        principal: {
          subject: 'secret-success-subject',
          clientId: 'secret-success-client',
          scopes: new Set(['echo:read']),
          claims: { email: 'secret-success@example.test' },
        },
        logger,
        dependencies: { prefix: '' },
      }),
    );
    await invokeTool(
      echoTool,
      { value: 'denied' },
      createRequestContext({
        requestId: 'request-4-denied',
        principal: {
          subject: 'secret-denied-subject',
          clientId: 'secret-denied-client',
          scopes: new Set(),
          claims: { email: 'secret-denied@example.test' },
        },
        logger,
        dependencies: { prefix: '' },
      }),
    );
    expect(JSON.stringify(records)).not.toContain('secret');
    expect(causes).toHaveLength(1);
    expect(records.map(({ event }) => event)).toEqual([
      'tool.started',
      'tool.failed',
      'tool.started',
      'tool.completed',
      'tool.started',
      'tool.denied',
    ]);
    expect(records.every((record) => !('subject' in record) && !('claims' in record))).toBe(true);
    expect(Object.keys(records.at(-1) ?? {}).sort()).toEqual(
      ['durationMs', 'errorCode', 'event', 'outcome', 'requestId', 'toolName'].sort(),
    );
  });

  it('uses conservative annotations for every risk class', () => {
    expect(riskToAnnotations({ kind: 'mutating' })).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(riskToAnnotations({ kind: 'destructive', openWorld: true })).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('infers structured content from the declared output schema', () => {
    expectTypeOf<Awaited<ReturnType<typeof echoTool.handler>>>().toEqualTypeOf<
      McpToolResult<typeof echoOutputSchema>
    >();

    defineTool<Dependencies>()({
      name: 'invalid-output',
      description: 'Compile-time output fixture',
      inputSchema: z.object({}),
      outputSchema: echoOutputSchema,
      requiredScopes: [],
      risk: { kind: 'read' },
      // @ts-expect-error Successful structured content must match outputSchema.
      handler() {
        return {
          content: [{ type: 'text', text: 'invalid' }],
          structuredContent: { text: 123 },
        };
      },
    });
  });

  it('does not let a throwing logger alter or leak a tool outcome', async () => {
    const result = await invokeTool(
      echoTool,
      { value: 'ok' },
      createRequestContext({
        requestId: 'request-5',
        principal: createTestPrincipal('user-5', ['echo:read']),
        logger: {
          log() {
            throw new Error('logger secret');
          },
          error() {
            throw new Error('logger secret');
          },
        },
        dependencies: { prefix: '' },
      }),
    );
    expect(result).toMatchObject({ content: [{ text: 'ok' }] });
    expect(JSON.stringify(result)).not.toContain('logger secret');
  });
});

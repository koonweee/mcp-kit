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
} from '../../src/index.js';
import { connectInMemory, createTestPrincipal, invokeTool } from '../../src/test/index.js';

interface Dependencies {
  readonly prefix: string;
}

const echoTool = defineTool<Dependencies>()({
  name: 'echo',
  description: 'Echo a value',
  inputSchema: z.object({ value: z.string() }),
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
    expect(listed.tools[0]?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const result = await connected.client.callTool({ name: 'echo', arguments: { value: 'hello' } });
    expect(result).toMatchObject({ content: [{ type: 'text', text: '>hello' }] });
    await connected.close();
  });

  it('denies missing scopes before the service handler runs', async () => {
    let called = false;
    const protectedTool = defineTool<Dependencies>()({
      ...echoTool,
      handler() {
        called = true;
        return { content: [{ type: 'text', text: 'unsafe' }] };
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
            return { content: [{ type: 'text', text: 'called' }] };
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

  it('sanitizes internal failures and emits only allowlisted operational fields', async () => {
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
        principal: createTestPrincipal('user-4', ['echo:read']),
        logger,
        dependencies: { prefix: 'secret prefix' },
      }),
    );
    expect(result).toMatchObject({ isError: true, content: [{ text: 'Safe failure' }] });
    expect(JSON.stringify(records)).not.toContain('secret');
    expect(causes).toHaveLength(1);
    expect(Object.keys(records.at(-1) ?? {}).sort()).toEqual(
      ['durationMs', 'errorCode', 'event', 'outcome', 'requestId', 'subject', 'toolName'].sort(),
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

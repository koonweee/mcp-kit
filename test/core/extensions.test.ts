import {
  INTERNAL_ERROR,
  ProtocolError,
  ResourceNotFoundError,
  ResourceTemplate,
  inputRequired,
  type ReadResourceResult,
} from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { afterEach, vi } from 'vitest';
import {
  McpPublicError,
  createRequestContext,
  defineServer,
  mcpExtensionErrorBoundary,
  silentLogger,
} from '../../src/index.js';
import { connectInMemory } from '../../src/test/index.js';

const emptyContext = () =>
  createRequestContext({
    requestId: 'opaque-extension-request',
    logger: silentLogger,
    dependencies: {},
  });

describe('extension error boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes unexpected resource and prompt failures over the official protocol', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const privateResourceFailure = 'PRIVATE_RESOURCE_DB_FAILURE';
    const privatePromptFailure = 'PRIVATE_PROMPT_DB_FAILURE';
    const promptSchema = z.object({ report: z.string() });
    const definition = defineServer<Record<string, never>>()({
      name: 'extension-error-boundary',
      version: '1.0.0',
      tools: [],
      extend(server) {
        server.registerResource(
          'private-resource',
          'test://private-resource',
          { mimeType: 'text/plain' },
          mcpExtensionErrorBoundary.resource(async () => {
            await Promise.resolve();
            throw new Error(privateResourceFailure);
          }),
        );
        server.registerPrompt(
          'private-prompt',
          { argsSchema: promptSchema },
          mcpExtensionErrorBoundary.prompt(promptSchema, async () => {
            await Promise.resolve();
            throw new Error(privatePromptFailure);
          }),
        );
      },
    });
    const connected = await connectInMemory(definition, emptyContext());
    try {
      for (const operation of [
        () => connected.client.readResource({ uri: 'test://private-resource' }),
        () =>
          connected.client.getPrompt({
            name: 'private-prompt',
            arguments: { report: 'monthly' },
          }),
      ]) {
        const request = operation();
        await expect(request).rejects.toMatchObject({
          code: INTERNAL_ERROR,
          message: 'The MCP request could not be completed',
          data: undefined,
        });
        await expect(request).rejects.not.toHaveProperty('cause');
        await expect(request).rejects.not.toThrow(/PRIVATE_/u);
      }
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleInfo).not.toHaveBeenCalled();
    } finally {
      await connected.close();
    }
  });

  it('preserves public messages, official protocol errors, results, and input-required results', () => {
    const publicFailure = mcpExtensionErrorBoundary.resource(() => {
      throw new McpPublicError('report_unavailable', 'Report unavailable', {
        cause: new Error('PRIVATE_PUBLIC_CAUSE'),
      });
    });
    try {
      void publicFailure(new URL('test://public'), {} as never);
      throw new Error('Expected public resource failure');
    } catch (error) {
      expect(error).toMatchObject({
        code: INTERNAL_ERROR,
        message: 'Report unavailable',
        data: undefined,
      });
      expect(error).not.toHaveProperty('cause');
      expect(String(error)).not.toContain('PRIVATE_PUBLIC_CAUSE');
    }

    const notFound = new ResourceNotFoundError('test://missing');
    const protocolFailure = mcpExtensionErrorBoundary.resource(() => {
      throw notFound;
    });
    expect(() => protocolFailure(new URL('test://missing'), {} as never)).toThrow(notFound);

    const resourceResult: ReadResourceResult = {
      contents: [{ uri: 'test://ok', text: 'ok' }],
    };
    const successful = mcpExtensionErrorBoundary.resource(() => resourceResult);
    expect(successful(new URL('test://ok'), {} as never)).toBe(resourceResult);

    const required = inputRequired({ requestState: 'extension-round-1' });
    const template = mcpExtensionErrorBoundary.resourceTemplate(() => required);
    expect(template(new URL('test://round'), {}, {} as never)).toBe(required);

    const completion = mcpExtensionErrorBoundary.completeResourceTemplate(() => [
      'first',
      'second',
    ]);
    expect(completion('f')).toEqual(['first', 'second']);

    const resources = mcpExtensionErrorBoundary.listResources(() => ({ resources: [] }));
    expect(resources({} as never)).toEqual({ resources: [] });

    const templateWithSafeCallbacks = new ResourceTemplate('test://{name}', {
      list: resources,
      complete: { name: completion },
    });
    expect(templateWithSafeCallbacks).toBeInstanceOf(ResourceTemplate);
  });

  it('keeps the generic boundary usable for other official extension callbacks', async () => {
    const callback = mcpExtensionErrorBoundary.wrap((value: number) => Promise.resolve(value * 2));
    await expect(callback(4)).resolves.toBe(8);

    const failure = mcpExtensionErrorBoundary.wrap(() => {
      throw new ProtocolError(INTERNAL_ERROR, 'Known safe protocol failure');
    });
    expect(() => failure()).toThrow('Known safe protocol failure');
  });
});

import { Client, InMemoryTransport, type ClientOptions } from '@modelcontextprotocol/client';
import type { McpRequestContext } from '../core/context.js';
import {
  createMcpServer,
  executeToolDefinition,
  type McpServerDefinition,
  type McpToolDefinition,
  type McpToolResult,
} from '../core/definition.js';
import { McpPublicError } from '../core/errors.js';
import type { ServerContext, StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import type { z } from 'zod/v4';

/**
 * Calls one definition directly while preserving Zod parsing, policy, logging, and sanitization.
 * Pass an official SDK context as the fourth argument when the handler inspects its invocation context.
 */
export async function invokeTool<
  TDependencies,
  TInputSchema extends z.ZodType,
  TOutputSchema extends StandardSchemaWithJSON | undefined,
>(
  tool: McpToolDefinition<TDependencies, TInputSchema, TOutputSchema>,
  input: unknown,
  context: McpRequestContext<TDependencies>,
  sdkContext?: ServerContext,
): Promise<McpToolResult<TOutputSchema>> {
  const parsed = await tool.inputSchema.safeParseAsync(input);
  if (!parsed.success) {
    throw new McpPublicError('invalid_input', 'Invalid tool input', { cause: parsed.error });
  }
  return executeToolDefinition(tool, parsed.data, context, sdkContext);
}

/** A connected official client/server pair for fast, protocol-independent definition tests. */
export interface InMemoryMcpClient {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

/** Connects an official client through the SDK's linked in-memory transports. */
export async function connectInMemory<TDependencies>(
  definition: McpServerDefinition<TDependencies>,
  context: McpRequestContext<TDependencies>,
  clientOptions?: ClientOptions,
): Promise<InMemoryMcpClient> {
  const server = await createMcpServer(definition, context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-kit-test', version: '1.0.0' }, clientOptions);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

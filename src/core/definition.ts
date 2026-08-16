import {
  McpServer,
  type CallToolResult,
  type MetaObject,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import type { z } from 'zod/v4';
import type { McpRequestContext } from './context.js';
import { toPublicError } from './errors.js';
import { enforceRequiredScopes, riskToAnnotations, type McpToolRisk } from './policy.js';

type McpToolErrorResult = CallToolResult & { readonly isError: true };

type McpToolSuccessResult<TOutputSchema extends StandardSchemaWithJSON> = CallToolResult & {
  readonly structuredContent: StandardSchemaWithJSON.InferOutput<TOutputSchema>;
  readonly isError?: false;
};

/** MCP-compatible result returned by kit tool handlers. `content` is always required. */
export type McpToolResult<TOutputSchema extends StandardSchemaWithJSON | undefined = undefined> =
  | McpToolErrorResult
  | (TOutputSchema extends StandardSchemaWithJSON
      ? McpToolSuccessResult<TOutputSchema>
      : CallToolResult);

/** One explicit, typed tool owned by a consuming service. */
export interface McpToolDefinition<
  TDependencies,
  TInputSchema extends z.ZodType,
  TOutputSchema extends StandardSchemaWithJSON | undefined = undefined,
> {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema?: TOutputSchema;
  readonly _meta?: MetaObject;
  readonly requiredScopes: readonly string[];
  readonly risk: McpToolRisk;
  readonly handler: (
    input: z.output<TInputSchema>,
    context: McpRequestContext<TDependencies>,
  ) => McpToolResult<TOutputSchema> | Promise<McpToolResult<TOutputSchema>>;
}

/** A portable server definition with no runtime, Auth0, environment, or service-client imports. */
export interface McpServerDefinition<TDependencies> {
  readonly name: string;
  readonly version: string;
  readonly title?: string;
  readonly instructions?: string;
  readonly tools: readonly McpToolDefinition<
    TDependencies,
    z.ZodType,
    StandardSchemaWithJSON | undefined
  >[];
  readonly extend?: (
    server: McpServer,
    context: McpRequestContext<TDependencies>,
  ) => void | Promise<void>;
}

/** Curried helper that preserves dependency and Zod input inference. */
export function defineTool<TDependencies>() {
  return <
    TInputSchema extends z.ZodType,
    TOutputSchema extends StandardSchemaWithJSON | undefined = undefined,
  >(
    definition: McpToolDefinition<TDependencies, TInputSchema, TOutputSchema>,
  ): McpToolDefinition<TDependencies, TInputSchema, TOutputSchema> => Object.freeze(definition);
}

/** Curried helper for a definition whose tools share one injected dependency type. */
export function defineServer<TDependencies>() {
  return (definition: McpServerDefinition<TDependencies>): McpServerDefinition<TDependencies> =>
    Object.freeze({ ...definition, tools: Object.freeze([...definition.tools]) });
}

/** Executes a validated tool definition with scope enforcement, sanitization, and safe logging. */
export async function executeToolDefinition<
  TDependencies,
  TInputSchema extends z.ZodType,
  TOutputSchema extends StandardSchemaWithJSON | undefined,
>(
  tool: McpToolDefinition<TDependencies, TInputSchema, TOutputSchema>,
  input: z.output<TInputSchema>,
  context: McpRequestContext<TDependencies>,
): Promise<McpToolResult<TOutputSchema>> {
  const startedAt = Date.now();
  const base = {
    requestId: context.requestId,
    ...(context.principal ? { subject: context.principal.subject } : {}),
    toolName: tool.name,
  };

  const safeLog = (operation: () => void) => {
    try {
      operation();
    } catch {
      // Observability must never change tool behavior or expose logger failures through the SDK.
    }
  };
  safeLog(() => {
    context.logger.log({ event: 'tool.started', ...base });
  });
  try {
    enforceRequiredScopes(context.principal, tool.requiredScopes);
    const result = await tool.handler(input, context);
    safeLog(() => {
      context.logger.log({
        event: 'tool.completed',
        ...base,
        durationMs: Date.now() - startedAt,
        outcome: 'success',
      });
    });
    return result;
  } catch (cause) {
    const error = toPublicError(cause);
    const denied = error.code === 'insufficient_scope';
    const record = {
      event: denied ? ('tool.denied' as const) : ('tool.failed' as const),
      ...base,
      durationMs: Date.now() - startedAt,
      outcome: denied ? ('denied' as const) : ('error' as const),
      errorCode: error.code,
    };
    if (denied)
      safeLog(() => {
        context.logger.log(record);
      });
    else
      safeLog(() => {
        context.logger.error(record, cause);
      });
    return {
      content: [{ type: 'text', text: error.publicMessage }],
      isError: true,
    };
  }
}

/** Builds a fresh official SDK server for exactly one request or test connection. */
export async function createMcpServer<TDependencies>(
  definition: McpServerDefinition<TDependencies>,
  context: McpRequestContext<TDependencies>,
): Promise<McpServer> {
  const server = new McpServer(
    {
      name: definition.name,
      version: definition.version,
      ...(definition.title ? { title: definition.title } : {}),
    },
    definition.instructions ? { instructions: definition.instructions } : undefined,
  );

  for (const tool of definition.tools) {
    server.registerTool(
      tool.name,
      {
        ...(tool.title ? { title: tool.title } : {}),
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: riskToAnnotations(tool.risk),
        ...(tool._meta ? { _meta: tool._meta } : {}),
      },
      async (input) => executeToolDefinition(tool, input, context),
    );
  }

  await definition.extend?.(server, context);
  return server;
}

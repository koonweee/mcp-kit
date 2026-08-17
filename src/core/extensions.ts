import {
  INTERNAL_ERROR,
  ProtocolError,
  type CompleteResourceTemplateCallback,
  type ListResourcesCallback,
  type PromptCallback,
  type ReadResourceCallback,
  type ReadResourceTemplateCallback,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { toPublicError } from './errors.js';

type ExtensionCallback<TArgs extends unknown[], TResult> = (...args: TArgs) => TResult;

function toExtensionProtocolError(cause: unknown): ProtocolError {
  if (ProtocolError.isInstance(cause)) return cause;
  const error = toPublicError(cause, 'The MCP request could not be completed');
  return new ProtocolError(INTERNAL_ERROR, error.publicMessage);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  return typeof Reflect.get(value, 'then') === 'function';
}

function wrap<TArgs extends unknown[], TResult>(
  callback: ExtensionCallback<TArgs, TResult>,
): ExtensionCallback<TArgs, TResult> {
  return (...args: TArgs): TResult => {
    try {
      const result = callback(...args);
      if (!isPromiseLike(result)) return result;
      return Promise.resolve(result).catch((cause: unknown) => {
        throw toExtensionProtocolError(cause);
      }) as TResult;
    } catch (cause) {
      throw toExtensionProtocolError(cause);
    }
  };
}

function prompt(callback: PromptCallback): PromptCallback;
function prompt<TArgsSchema extends StandardSchemaWithJSON>(
  argsSchema: TArgsSchema,
  callback: PromptCallback<TArgsSchema>,
): PromptCallback<TArgsSchema>;
function prompt(schemaOrCallback: unknown, maybeCallback?: unknown): unknown {
  const callback = maybeCallback ?? schemaOrCallback;
  if (typeof callback !== 'function') {
    throw new TypeError('mcpExtensionErrorBoundary.prompt requires a callback');
  }
  return wrap(callback as ExtensionCallback<unknown[], unknown>);
}

/**
 * Typed error boundaries for low-level official SDK callbacks registered through `extend`.
 *
 * Valid results and official `ProtocolError` instances pass through unchanged. `McpPublicError`
 * messages remain public; every other rejection becomes a fixed internal-error response with no
 * cause or data. The boundary deliberately does not log callback arguments, results, or causes.
 */
export const mcpExtensionErrorBoundary = Object.freeze({
  wrap,
  resource(callback: ReadResourceCallback): ReadResourceCallback {
    return wrap(callback);
  },
  resourceTemplate(callback: ReadResourceTemplateCallback): ReadResourceTemplateCallback {
    return wrap(callback);
  },
  listResources(callback: ListResourcesCallback): ListResourcesCallback {
    return wrap(callback);
  },
  completeResourceTemplate(
    callback: CompleteResourceTemplateCallback,
  ): CompleteResourceTemplateCallback {
    return wrap(callback);
  },
  prompt,
});

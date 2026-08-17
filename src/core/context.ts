import type { McpLogger } from './logging.js';
import type { McpClientSupport } from './client-support.js';

/** An authenticated identity and its validated OAuth scopes. */
export interface McpPrincipal {
  readonly subject: string;
  readonly scopes: ReadonlySet<string>;
  readonly clientId?: string;
  readonly expiresAt?: number;
  readonly claims?: Readonly<Record<string, unknown>>;
}

/** Runtime-neutral information about the request that created a server instance. */
export interface McpRequestInfo {
  readonly method?: string;
  readonly url?: URL;
  readonly protocolEra?: 'legacy' | 'modern';
}

/** Per-request values passed to every tool handler. */
export interface McpRequestContext<TDependencies> {
  readonly requestId: string;
  readonly principal?: McpPrincipal;
  readonly logger: McpLogger;
  readonly dependencies: TDependencies;
  readonly request?: McpRequestInfo;
}

/** Request context passed to tool handlers after per-request client support is resolved. */
export interface McpToolRequestContext<TDependencies> extends McpRequestContext<TDependencies> {
  readonly client: McpClientSupport;
}

/** Inputs used to construct one isolated request context. */
export interface McpRequestContextOptions<TDependencies> {
  readonly requestId: string;
  readonly principal?: McpPrincipal;
  readonly logger: McpLogger;
  readonly dependencies: TDependencies;
  readonly request?: McpRequestInfo;
}

/** Creates an immutable request context without consulting environment variables. */
export function createRequestContext<TDependencies>(
  options: McpRequestContextOptions<TDependencies>,
): McpRequestContext<TDependencies> {
  return Object.freeze({ ...options });
}

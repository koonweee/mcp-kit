/** Stable public error that keeps an internal cause without exposing it to MCP clients. */
export class McpPublicError extends Error {
  readonly code: string;
  readonly publicMessage: string;

  constructor(code: string, publicMessage: string, options?: ErrorOptions) {
    super(publicMessage, options);
    this.name = 'McpPublicError';
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

/** Raised when a validated principal lacks one or more required tool scopes. */
export class McpScopeError extends McpPublicError {
  readonly requiredScopes: readonly string[];

  constructor(requiredScopes: readonly string[]) {
    super('insufficient_scope', 'Insufficient scope');
    this.name = 'McpScopeError';
    this.requiredScopes = [...requiredScopes];
  }
}

/** Converts arbitrary failures to a stable, sanitized public error. */
export function toPublicError(error: unknown): McpPublicError {
  if (error instanceof McpPublicError) return error;
  return new McpPublicError('internal_error', 'The tool could not be completed', { cause: error });
}

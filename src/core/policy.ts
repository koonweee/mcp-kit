import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type { McpPrincipal } from './context.js';
import { McpScopeError } from './errors.js';

/** Server-authoritative risk metadata. MCP annotations derived from it remain client hints only. */
export interface McpToolRisk {
  readonly kind: 'read' | 'mutating' | 'destructive';
  readonly idempotent?: boolean;
  readonly openWorld?: boolean;
}

/** Derives conservative MCP hints without granting any permission. */
export function riskToAnnotations(risk: McpToolRisk): ToolAnnotations {
  return {
    readOnlyHint: risk.kind === 'read',
    destructiveHint: risk.kind === 'destructive',
    idempotentHint: risk.idempotent ?? risk.kind === 'read',
    openWorldHint: risk.openWorld ?? false,
  };
}

/** Denies anonymous or under-scoped principals before service code runs. */
export function enforceRequiredScopes(
  principal: McpPrincipal | undefined,
  requiredScopes: readonly string[],
): void {
  const missing = requiredScopes.filter((scope) => !principal?.scopes.has(scope));
  if (missing.length > 0) throw new McpScopeError(missing);
}

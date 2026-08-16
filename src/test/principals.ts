import type { McpPrincipal } from '../core/context.js';

/** Creates an immutable test principal without a live identity provider. */
export function createTestPrincipal(
  subject = 'test-user',
  scopes: readonly string[] = [],
  options: { readonly clientId?: string; readonly expiresAt?: number } = {},
): McpPrincipal {
  return Object.freeze({
    subject,
    scopes: new Set(scopes),
    ...(options.clientId ? { clientId: options.clientId } : {}),
    ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
  });
}

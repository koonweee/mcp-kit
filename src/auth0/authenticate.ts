import {
  requireBearerAuth,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import type { McpPrincipal } from '../core/context.js';

/** Options for a standards-compliant bearer gate suitable for the Node adapter. */
export interface Auth0BearerGateOptions {
  readonly verifier: OAuthTokenVerifier;
  readonly requiredScopes?: readonly string[];
  readonly resourceMetadataUrl?: string;
}

/** Creates a Web request authenticator that returns validated SDK auth info or a 401/403 response. */
export function createAuth0BearerGate(options: Auth0BearerGateOptions) {
  return requireBearerAuth({
    verifier: options.verifier,
    ...(options.requiredScopes ? { requiredScopes: [...options.requiredScopes] } : {}),
    ...(options.resourceMetadataUrl ? { resourceMetadataUrl: options.resourceMetadataUrl } : {}),
  });
}

/** Converts validated Auth0 auth info into the kit's portable principal. */
export function principalFromAuthInfo(authInfo: AuthInfo): McpPrincipal {
  const subject = authInfo.extra?.['subject'];
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new TypeError('Validated auth info is missing a subject');
  }
  return Object.freeze({
    subject,
    clientId: authInfo.clientId,
    scopes: new Set(authInfo.scopes),
    ...(authInfo.expiresAt !== undefined ? { expiresAt: authInfo.expiresAt } : {}),
  });
}

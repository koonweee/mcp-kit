# Auth0 resource-server setup

`mcp-kit` is an OAuth resource server, not an authorization server. Auth0 owns login, consent, client registration, grants, sessions, refresh tokens, and token issuance. The kit verifies each bearer token locally from Auth0's JWKS and publishes RFC 9728 protected-resource metadata; it stores no token or OAuth state.

## Auth0 contract

Configure one Auth0 API for each independently deployed MCP resource:

1. Use the MCP server's canonical public URL, including its meaningful path, as the API identifier and OAuth resource. For example, `https://notes.example.com/mcp`.
2. Select `RS256`. The verifier intentionally accepts no other signing algorithm.
3. Prefer the `rfc9068_profile_authz` token dialect and enable RBAC policy enforcement when roles control tools.
4. Register every OAuth scope that tools declare, with least-privilege descriptions.
5. Enable Auth0's Resource Parameter Compatibility Profile and Include Issuer in Authorization Responses tenant settings for MCP clients.
6. Use the exact issuer published by Auth0 discovery, including its trailing slash. When selecting a custom Auth0 domain, use that domain consistently for `AUTH0_ISSUER`, authorization-server metadata, token and JWKS validation, and client authorization flows. Never mix the canonical tenant issuer with the custom issuer.

Each MCP resource remains an independent endpoint and OAuth audience regardless of which Auth0 issuer domain is selected. Auth0 authorization requests must receive that resource's canonical URL, and tokens must contain it in `aud`. The verifier checks signature, RS256, issuer, audience, expiry, and a non-empty subject. It maps the space-delimited `scope` claim to the principal. Auth0's `permissions` claim is not silently promoted into OAuth scopes.

Auth0 tenant provisioning, client registration policy, CIMD or DCR administration, roles, login UI, and downstream token exchange remain outside this library. Follow [Auth0's MCP guidance](https://auth0.com/ai/docs/mcp/get-started/authorization-for-your-mcp-server) for those operator actions.

## Wire the resource server

Keep these values in the consuming service's runtime configuration. The issuer and audience are identifiers, not secrets; credentials still must never enter source control.

```ts
import {
  createAuth0BearerGate,
  createAuth0ProtectedResourceHandler,
  createAuth0Verifier,
  getAuth0ProtectedResourceMetadataUrl,
  principalFromAuthInfo,
} from '@koonweee/mcp-kit/auth0';
import { serveNode } from '@koonweee/mcp-kit/node';
import { notesServer } from './definition.js';
import { createNotesClient } from './notes-client.js';

const issuer = new URL(process.env.AUTH0_ISSUER!);
const resourceServerUrl = new URL(process.env.MCP_SERVER_URL!);
const scopesSupported = ['notes:read'];

const verifier = createAuth0Verifier({
  issuer,
  audience: resourceServerUrl,
});

const resourceMetadataUrl = getAuth0ProtectedResourceMetadataUrl(resourceServerUrl);

const running = await serveNode(notesServer, {
  hostname: '0.0.0.0',
  allowedHostnames: ['notes.example.com'],
  allowedOriginHostnames: ['chatgpt.com'],
  authenticate: createAuth0BearerGate({ verifier, resourceMetadataUrl }),
  principalFromAuthInfo,
  discovery: createAuth0ProtectedResourceHandler({
    issuer,
    resourceServerUrl,
    scopesSupported,
    resourceName: 'Notes MCP',
  }),
  dependencies: () => ({
    notes: createNotesClient(process.env.NOTES_API_URL!, process.env.NOTES_API_TOKEN!),
  }),
});
```

The path-aware metadata URL for `https://notes.example.com/mcp` is `https://notes.example.com/.well-known/oauth-protected-resource/mcp`. Metadata advertises Auth0 in `authorization_servers` and the exact MCP endpoint in `resource`. The Auth0 JWKS URL is not the metadata document's `jwks_uri`: RFC 9728 reserves that field for keys belonging to the protected resource itself.

The bearer gate returns `401` for missing, malformed, invalid, or expired tokens and `403 insufficient_scope` when its optional endpoint-wide `requiredScopes` are missing. Both challenges include `resource_metadata`. Tool-specific scopes remain enforced immediately before each handler and return a sanitized MCP tool error.

JWKS lookup defaults to a five-second timeout, a 30-second refresh cooldown, and a ten-minute cache maximum. One verifier may be shared by requests so public keys are cached and rotation is handled; tokens are never cached. Override JWKS settings primarily for deterministic tests. `dangerouslyAllowInsecureIssuerUrl` is only for a localhost issuer in local tests and must never be enabled in production.

## Local tests and manual tenant smoke

Automated tests use `createTestJwtAuthority` from `@koonweee/mcp-kit/test`; they do not need or contact Auth0. Run them as described in [Testing](testing.md).

After automated verification, perform this optional smoke against the real tenant before the first deployment:

1. Confirm the tenant settings, exact issuer, API identifier, RS256 dialect, and registered scopes above.
2. Start the consumer behind its intended TLS hostname and reverse proxy with explicit allowed hosts and origins.
3. Fetch the path-aware protected-resource metadata URL. Confirm `resource`, `authorization_servers`, and `scopes_supported` exactly match the deployment.
4. Request `/mcp` without a token. Confirm `401` and a `WWW-Authenticate` challenge pointing to that metadata URL.
5. Connect an MCP client or Inspector through Auth0. Initialize, list tools, call an allowed tool, then use a user or grant without one tool scope and confirm denial before the backend call.
6. Review logs and responses to confirm they contain no access token, subject, client ID, scope or other claim, credentials, arguments, results, or internal validation cause. Operational logs correlate only through an opaque request ID that is independent of caller identity.

Do not paste a real token into documentation, chat, test fixtures, or command history. This procedure validates integration only; durable tenant and deployment changes belong to their owning repositories.

## Agent guidance

- Owning files: `src/auth0/verifier.ts`, `src/auth0/authenticate.ts`, and `src/auth0/metadata.ts`; HTTP composition lives in `src/node/server.ts`.
- Preserve exact trusted issuer and audience checks, custom-domain issuer consistency, RS256, required expiry and subject, bounded public-key caching, generic public errors, path-aware discovery, and zero token storage.
- Verify changes with `pnpm vitest run test/auth0 test/node/server.test.ts`; use the manual smoke only after automated gates pass.
- Read [Testing](testing.md) next for local JWT fixtures and authenticated HTTP coverage.

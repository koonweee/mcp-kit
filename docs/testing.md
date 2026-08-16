# Testing

Test at the narrowest seam that proves the behavior, then use the packed-package gates for public-contract changes. No automated test needs a live Auth0 tenant.

## Direct tool tests

Use `createTestPrincipal`, `createRequestContext`, and `invokeTool` to test one tool with Zod parsing, scope policy, safe error conversion, and logging but without a transport.

```ts
import { createRequestContext, silentLogger } from '@jtkw/mcp-kit';
import { createTestPrincipal, invokeTool } from '@jtkw/mcp-kit/test';
import { getNote } from '../src/definition.js';

const result = await invokeTool(
  getNote,
  { id: 'note-1' },
  createRequestContext({
    requestId: 'test-1',
    principal: createTestPrincipal('user-1', ['notes:read']),
    logger: silentLogger,
    dependencies: { notes: fakeNotes },
  }),
);
```

Assert that invalid input and missing scopes prevent the service dependency from being called. For failure paths, assert public messages and allowlisted log fields rather than internal exception text.

## In-memory protocol tests

`connectInMemory(definition, context)` connects an official MCP client to a fresh server through linked transports. Use it to verify initialization, tool discovery, annotations, SDK schema behavior, and tool results without HTTP. Always call the returned `close()`.

## Authenticated HTTP tests

`createTestJwtAuthority()` creates an ephemeral RS256 issuer with an in-memory JWKS fetch function. Private keys stay closure-local and are not exported from production package paths. Pair its values with `createAuth0Verifier`, then pass `createAuth0BearerGate` and `principalFromAuthInfo` to `serveNode`.

Cover valid calls plus wrong issuer, wrong audience, expiry, invalid signature, missing subject, missing or malformed scope, insufficient scope, and JWKS rotation. For rotation tests, set the verifier's JWKS cooldown to zero, rotate the fixture while retaining its previous key, and assert the new key triggers one refresh. Also exercise concurrent principals and dependencies to prove request isolation.

Use a real local HTTP listener for routing, host/origin checks, body bounds, health, graceful shutdown, and official client behavior. The official client should exercise both the modern `2026-07-28` mode and the default supported legacy stateless flow where compatibility matters.

## Verification commands

```bash
# one area
pnpm vitest run test/core
pnpm vitest run test/node
pnpm vitest run test/auth0

# package and documentation boundaries
pnpm docs:check
pnpm pack:check
pnpm test:exports
pnpm test:consumer
pnpm test:container
pnpm release:check -- v0.1.0

# canonical full gate
pnpm verify
```

`test:exports` installs the packed tarball into a temporary project, typechecks, and imports every public subpath. `test:consumer` compiles and runs the neutral example against the tarball rather than workspace source. `test:container` builds the example Docker image from that tarball and removes the temporary image. `pack:check` rejects unintended package files and production exposure of signing fixtures or private keys. `release:check` matches the tag, package version, and changelog entry. Run these gates after changing exports, declarations, examples, dependencies, or release metadata.

The optional real-tenant procedure is intentionally kept in [Auth0](auth0.md); do not reproduce it in test files or CI.

## Agent guidance

- Owning files: `src/test/` owns public helpers; `test/core/`, `test/node/`, and `test/auth0/` own runtime evidence; `scripts/test-exports.mjs` and `scripts/test-consumer.mjs` own artifact and consumer gates.
- Keep signing material test-only, prefer behavioral assertions over implementation strings, close clients and servers, and never require network credentials in the default suite.
- Verify helper changes with `pnpm vitest run test/core test/auth0 test/node`, then run `pnpm test:exports` if a public test export changed.
- Read [Runtime adapters](adapters.md) next for host-level behavior and the unsupported Cloudflare seam.

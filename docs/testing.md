# Testing

Test at the narrowest seam that proves the behavior, then use the packed-package gates for public-contract changes. No automated test needs a live Auth0 tenant.

## Direct tool tests

Use `createTestPrincipal`, `createRequestContext`, and `invokeTool` to test one tool with Zod parsing, scope policy, safe error conversion, and logging but without a transport.

For every low-level callback registered through `extend`, test the matching
`mcpExtensionErrorBoundary` adapter with an unexpected sentinel failure. Use an official client to
assert the response is protocol internal error `-32603`, its message is exactly
`The MCP request could not be completed`, and neither the sentinel nor a cause or error data crosses
the wire. Separately cover any deliberately public `McpPublicError` and official `ProtocolError`
semantics the extension uses.

When testing a custom logger, use sentinel principal subjects and claims and assert that none appear
in any started, completed, denied, or failed record. Correlate records through an opaque request ID;
never derive that ID from the test principal or a real identity-provider value.

The packed Node 24 container runs an authenticated CommonJS Jest fixture with no `NODE_OPTIONS` or
experimental VM-module flag. Preserve that check when changing Auth0, JWT helpers, package exports,
or the jose runtime bridge; requiring every consuming Jest repository to enable VM modules is not a
supported compatibility strategy.

```ts
import { createRequestContext, silentLogger } from '@koonweee/mcp-kit';
import { createTestPrincipal, invokeTool } from '@koonweee/mcp-kit/test';
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

The three-argument form remains suitable for existing handlers that ignore the official invocation context. When a direct test needs that third handler argument, pass an actual SDK `ServerContext` as `invokeTool`'s fourth argument. Prefer capturing it through `connectInMemory` instead of constructing a broad mock.

## In-memory protocol tests

`connectInMemory(definition, context, clientOptions?)` connects an official MCP client to a fresh server through linked transports. Pass official `ClientOptions.capabilities` to test legacy client-support branches. Use a real HTTP handler and a client pinned to `2026-07-28` for modern envelope behavior. Cover form-capable, URL-only, and incapable clients and assert the matching `context.client.inputRequired` booleans. Always call the returned `close()`.

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
pnpm release:check -- vX.Y.Z

# canonical full gate
pnpm verify
```

`test:exports` installs the packed tarball into a temporary project, typechecks both ESM and
CommonJS consumers, and exercises `import` and `require` for every public subpath. `test:consumer`
compiles and runs the neutral ESM example plus an authenticated CommonJS client/server smoke against
the tarball rather than workspace source. `test:container` builds the example Docker image from that
tarball and requires all CommonJS paths inside Node 24. `pack:check` rejects unintended package
files and production exposure of signing fixtures or private keys. `release:check` matches the tag,
package version, and changelog entry. Run these gates after changing exports, declarations,
examples, dependencies, or release metadata.

The optional real-tenant procedure is intentionally kept in [Auth0](auth0.md); do not reproduce it in test files or CI.

## Agent guidance

- Owning files: `src/test/` owns public helpers; `test/core/`, `test/node/`, and `test/auth0/` own runtime evidence; `scripts/test-exports.mjs` and `scripts/test-consumer.mjs` own artifact and consumer gates.
- Keep signing material test-only, prefer behavioral assertions over implementation strings, close clients and servers, and never require network credentials in the default suite.
- Verify helper changes with `pnpm vitest run test/core test/auth0 test/node`, then run `pnpm test:exports` if a public test export changed.
- Read [Runtime adapters](adapters.md) next for host-level behavior and the unsupported Cloudflare seam.

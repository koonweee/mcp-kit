# AGENTS.md

## Repository map

- `src/core/` owns portable server definitions, policy, errors, logging, and request context.
- `src/node/` owns the stateless Node Streamable HTTP adapter and server lifecycle.
- `src/auth0/` owns Auth0 JWT validation and OAuth protected-resource metadata.
- `src/test/` owns public test helpers; signing fixtures stay test-only.
- `test/` mirrors runtime areas; `scripts/test-exports.mjs` and `scripts/test-consumer.mjs` own packed-artifact checks.
- `examples/basic-node/` is the neutral reference consumer.
- `docs/` holds focused guides; `README.md` stays brief.

## Invariants

- Core must not import Node APIs, environment readers, Auth0, Cloudflare, or service code.
- Create a fresh MCP server, principal context, logger context, and service dependencies per request.
- Required scopes and server-side risk policy are authoritative; MCP annotations are hints only.
- Logs and public errors never expose arguments, results, tokens, secrets, or internal causes.
- Node is stateless. Do not add databases, session persistence, token storage, or resumability.
- Cloudflare remains documented and compile-only: no runtime adapter, dependency, or public export.
- Service-specific tools, API clients, credentials, deployment, and environment loading stay outside the kit.
- Modern multi-round input stays SDK-native: pass `ServerContext` and `InputRequiredResult` through, and require consumers to validate untrusted responses with `acceptedContent(..., schema)`.
- Public APIs are only `.`, `./node`, `./auth0`, `./test`, and the browser-only `./apps`; validate them from the packed tarball.

## Change routing

- Protocol-independent definitions and enforcement: `src/core/` plus `test/core/`.
- HTTP routing, host/origin protection, bounds, or shutdown: `src/node/` plus `test/node/`.
- JWT claims, JWKS, challenges, or discovery metadata: `src/auth0/` plus `test/auth0/`.
- Consumer ergonomics or public exports: `src/test/`, `scripts/test-exports.mjs`, `scripts/test-consumer.mjs`, and `examples/basic-node/`.
- Boundary or compatibility changes must update the matching focused document.

## Verification

- Focused tests: `pnpm vitest run <path>`
- Full gate: `pnpm verify`
- Package contents: `pnpm pack:check`
- Packed imports: `pnpm test:exports`
- External consumer: `pnpm test:consumer`
- Container consumer: `pnpm test:container`
- Documentation links: `pnpm docs:check`

Read `docs/architecture.md` next for dependency direction and deliberate exclusions.

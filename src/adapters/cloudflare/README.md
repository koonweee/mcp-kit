# Cloudflare adapter placeholder

Cloudflare Workers are not supported in V1. This directory records a compile-time design seam only; it must not contain a runtime adapter, Cloudflare dependency, public binding type, package export, or function that fails at runtime.

A future implementation should expose the official Web-standard MCP handler, receive Worker bindings and service dependencies explicitly, create a fresh server and context per request, and reuse the Auth0 verifier without persisting tokens. Service definitions and tool handlers must compile unchanged between Node and Workers.

Before implementation, define a real consumer and add tests for Worker request routing, host and origin policy, resource metadata, bearer challenges, JWKS caching and rotation, request isolation, platform limits, and packed external imports. Only then add a documented public export and advertise the runtime.

The canonical adapter status and implemented Node behavior are documented in [`docs/adapters.md`](../../../docs/adapters.md).

## Agent guidance

- Owning files: this note owns the planned seam; no Cloudflare runtime source exists. Portable constraints are owned by `src/core/` and the implemented comparison point is `src/node/server.ts`.
- Keep the directory documentation-only, Cloudflare unexported, and core free of Worker bindings or runtime dependencies until scope changes.
- Verify the boundary with `pnpm vitest run test/core/boundary.test.ts` and `pnpm test:exports`.
- Read [`docs/adapters.md`](../../../docs/adapters.md) next before proposing runtime work.

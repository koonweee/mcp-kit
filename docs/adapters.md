# Runtime adapters

The portable definition layer is host-independent. An adapter is responsible for turning a host request into a fresh official MCP server, creating request-local dependencies and context, passing validated identity, enforcing host-level protections, and closing lifecycle resources.

## Node

Node is the only supported runtime. `createNodeMcpHandler` composes the official SDK v2 `createMcpHandler` Web handler with `toNodeHandler`; it does not maintain a custom MCP transport.

The default routes are `/mcp` and `/healthz`. The adapter:

- creates a fresh server, request context, dependency object, principal view, and logger selection per MCP request;
- serves modern `2026-07-28` and supported 2025-era stateless requests through the SDK default;
- applies localhost host and origin protection unless explicit hostname allowlists are supplied;
- does not infer proxy trust from forwarded headers;
- accepts JSON POST bodies only and bounds them to 1 MiB by default;
- keeps health unauthenticated and configuration-free; and
- exposes `close()` so shutdown waits for active requests before closing the SDK handler.

`serveNode` binds to `127.0.0.1` and an ephemeral port by default. A deployed consumer must opt into its public bind address and configure exact public host/origin allowlists for its ingress. Reverse-proxy and Traefik configuration remains outside this repository.

Authentication is optional at the Node API level so definitions can be tested locally, but a public protected server composes the Auth0 gate and discovery handler from [Auth0](auth0.md).

## Adapter contract

A future adapter must preserve the same service definition and handler types. It receives bindings and dependencies explicitly, uses Web-standard request information in core, creates all mutable request state per request, and reuses Auth0 verification without adding token persistence. Runtime-specific APIs and environment loading stay in the adapter or consuming service, never in core.

## Cloudflare status

Cloudflare is planned, unimplemented, unsupported, and unexported. There is no `@jtkw/mcp-kit/cloudflare` path, runtime dependency, bindings type in the public core API, or placeholder function that throws. The compile-only design note is in [`src/adapters/cloudflare/README.md`](../src/adapters/cloudflare/README.md).

Adding it requires a concrete consumer and acceptance work for host/origin policy, explicit bindings, Web handler composition, request isolation, Auth0/JWKS behavior, limits, shutdown-equivalent cleanup, package exports, and external-consumer tests. Until then, Node remains the only advertised runtime.

## Agent guidance

- Owning files: `src/node/server.ts` and `test/node/` own the implemented adapter; `src/adapters/cloudflare/README.md` owns only the future seam.
- Preserve official SDK transport composition, stateless per-request construction, explicit proxy policy, bounded bodies, public minimal health, graceful shutdown, and the absence of a Cloudflare export.
- Verify Node changes with `pnpm vitest run test/node`; verify boundary or export changes with `pnpm vitest run test/core/boundary.test.ts` and `pnpm test:exports`.
- Read [Architecture](architecture.md) next before changing an adapter boundary; use [Auth0](auth0.md) for authentication composition.

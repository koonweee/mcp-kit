# Architecture

## Responsibility

`mcp-kit` centralizes mechanics that repeat across personal MCP servers: portable definitions, server-side scope and risk policy, safe errors and logging, stateless Node serving, Auth0 JWT verification and RFC 9728 discovery, and reusable test seams.

A consuming service owns its tools, business rules, backend API client, environment loading, service credentials, process entrypoint, container, and deployment. The stack repository owns ingress, secret delivery, image pinning, and rollout. There is no gateway database and no shared service credential store.

## Dependency direction

```text
service definition and dependencies
             |
             v
        portable core
          ^       ^
          |       |
       Node     Auth0
       adapter  resource-server support
```

`src/core/` may depend on Web-standard values and the official MCP server package, but not Node APIs, environment readers, Auth0, Cloudflare, or service code. Runtime and authentication adapters depend inward on core. Consumers inject request-local dependencies rather than core reading configuration.

The supported public paths are:

- `@koonweee/mcp-kit` for definitions, context, policy, logging, and public errors;
- `@koonweee/mcp-kit/node` for stateless Node serving;
- `@koonweee/mcp-kit/auth0` for JWT verification, bearer gating, and discovery; and
- `@koonweee/mcp-kit/test` for principals, in-memory protocol tests, and ephemeral JWT fixtures.

No internal source path is a compatibility surface.

Each supported path has conditional ESM and CommonJS exports with matching declarations. The two
formats implement the same API and policy behavior. The build transforms the allowlisted jose v6
APIs used by Auth0 verification and test JWTs into a packaged CommonJS runtime, preserving jose's
MIT notice. CommonJS consumers therefore do not need dynamic-import wrappers, Jest VM module flags,
or `NODE_OPTIONS`. The resulting module and JWKS resolver are reused, while tokens remain uncached.

## Request lifecycle

The Node adapter applies host and origin checks before routing. `/healthz` is public and reveals only `{ "status": "ok" }`. Auth0 discovery is handled before `/mcp`; the bearer gate validates an access token before the official MCP handler receives it.

For every MCP HTTP request, the SDK v2 handler creates a fresh MCP server. The adapter also creates a new principal view, request ID, logger selection, and dependency object. Nothing is resumed or stored between requests. The official handler serves the modern `2026-07-28` protocol and, by default, the supported 2025-era stateless flow; it does not create sessions for either era.

Before invoking a tool, core derives a narrow `context.client` support view from official SDK
runtime surfaces: the public per-request envelope and meta-key constants on modern requests, or the
public initialized capability accessor on legacy connections. Service code can branch on form/URL
input-required support without casting the incomplete SDK envelope declaration or probing private
server state. Raw client identity and capability objects are not copied into the service context.

Before a tool handler runs, Zod validates its input and core checks every declared required scope. Risk metadata maps to conservative MCP annotations, but those annotations are only client hints and never authorize a call. Tool failures are sanitized automatically. Low-level callbacks registered through `extend` use the typed `mcpExtensionErrorBoundary` adapters; unexpected resource, prompt, listing, completion, and other callback failures become a fixed protocol internal error with no cause or data. Official SDK protocol errors and explicitly approved `McpPublicError` messages retain their public semantics. Operational records contain an event, opaque request ID, tool name, and optional duration, outcome, or safe error code; they never contain principal identity, authentication claims, arguments, results, tokens, secrets, or internal causes. Extension boundaries deliberately do not log callback arguments, results, or failures. The request ID is the privacy-safe correlation seam and must not be derived from any caller identity or claim.

## Deliberate exclusions

V1 does not provide stateful sessions, resumability, databases, OAuth grant or token storage, a custom authorization server, server-owned human approval, MCP UI, background jobs, generic shell or arbitrary-HTTP tools, deployment manifests, or service-specific integrations.

Node is the only runtime implementation. The Cloudflare directory records a future design constraint; it has no runtime code, dependency, or public export. See [Runtime adapters](adapters.md).

## Compatibility and versioning

The package follows semantic versioning once released. A breaking change to a public subpath, definition or context type, Node minimum, supported MCP protocol era, authentication claim contract, or adapter behavior requires a major release. Additive helpers and support for another protocol revision may be minor when existing consumers continue to work unchanged. Security and correctness fixes are patches when they preserve the contract.

Consumers must pin a released package version rather than import a sibling checkout or unpinned
Git branch. Release gates include the full test suite, packed-file inspection, ESM and CommonJS
type/runtime checks from the tarball, authenticated external-consumer smokes, and post-publication
`import` and `require` checks from the public npm registry.

See [Releasing and adopting](releasing.md) for the tagged artifact contract and the first real consumer checklist.

## Agent guidance

- Owning files: `src/core/` owns portable behavior; `src/node/server.ts` owns HTTP lifecycle; `src/auth0/` owns resource-server authentication; `src/test/` owns reusable tests.
- Preserve inward dependency direction, per-request isolation, stateless serving, and the exclusions above.
- Verify boundary changes with `pnpm vitest run test/core/boundary.test.ts test/node/fetch-protocol.test.ts` and finish with `pnpm verify`.
- Read [Defining a server](server-definition.md) next for the portable API; use [Runtime adapters](adapters.md) for host-specific changes.

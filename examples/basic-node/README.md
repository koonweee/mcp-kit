# Basic Node example

This neutral consumer keeps its fake backend, environment loading, and tool definitions outside
`mcp-kit`. Copy the inspected package tarball to `mcp-kit.tgz`, set `AUTH0_ISSUER` and
`AUTH0_AUDIENCE`, then run `pnpm install && pnpm start`. The server exposes `/healthz`, `/mcp`, and
path-aware protected-resource metadata. Its read tool also demonstrates a neutral first-class MCP
Apps resource, standard tool linkage, and a text/structured fallback. The placeholder
`https://widgets.example.com` origin must be replaced by a consuming plugin's own canonical HTTPS
UI origin before submission. The Dockerfile consumes the same pinned tarball.

## Agent guidance

- `src/server.ts` owns the service-local tools, fake backend, Auth0 wiring, and process entrypoint.
- Keep service clients and environment reads here; never move them into `src/` at the repository root.
- Verify with `pnpm test:consumer`; it compiles and runs this example from the packed artifact.
- Read [`../../docs/testing.md`](../../docs/testing.md) next for consumer and HTTP test patterns.

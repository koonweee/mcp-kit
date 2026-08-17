# Changelog

## 0.2.3 - 2026-08-16

- Added `mcpExtensionErrorBoundary`, a typed public boundary for resource, resource-template,
  prompt, resource-listing, completion, and other low-level callbacks registered through `extend`.
- Unexpected extension callback failures now become a fixed protocol internal-error message with no
  cause or data, while approved `McpPublicError` messages and official SDK `ProtocolError` values
  retain their intended public semantics.
- Packed ESM and CommonJS declaration/runtime checks now cover sanitized extension failures through
  an authenticated official client.

## 0.2.2 - 2026-08-16

- Privacy-safe operational log records no longer include principal subjects or other authentication
  claims; opaque request IDs remain available for per-request correlation.
- `safeConsoleLogger` now projects an explicit runtime allowlist before serialization, preventing
  untyped extra fields and internal error causes from reaching the console.
- Authenticated CommonJS consumers now use a packaged jose v6 runtime instead of native dynamic
  import, including Jest on Node 24 without `--experimental-vm-modules` or `NODE_OPTIONS`.
- Tool handlers receive a typed, kit-owned `context.client` signal for modern and legacy form/URL
  input-required support while retaining the official `ServerContext` as the third argument.

## 0.2.1 - 2026-08-16

- Dual ESM and CommonJS package exports, declarations, packed-consumer checks, and Node 24
  container verification for all four public subpaths.
- Native lazy loading for ESM-only `jose` v6 so CommonJS Auth0 and JWT test helpers keep the same
  bounded JWKS cache and injectable-fetch behavior.

## 0.2.0 - 2026-08-16

- Official SDK v2 `ServerContext` and `InputRequiredResult` pass-through for SDK-native multi-round tool input.
- OIDC-only trusted publishing and a longer registry-propagation verification window.

## 0.1.0 - 2026-08-16

- Initial portable server definitions, stateless Node adapter, Auth0 resource-server support, and
  packed consumer test kit.
- Typed Standard Schema tool outputs with inferred structured content and tool-level extension
  metadata forwarded through the official MCP SDK.

## Agent guidance

- `package.json`, `scripts/check-release.mjs`, and `.github/workflows/release.yml` own version and artifact behavior.
- Preserve the public `@koonweee/mcp-kit` name, npm registry, and access settings; never work around a release failure by renaming the package or reusing a published version.
- Verify release inputs with `pnpm release:check -- v<version> && pnpm verify`.
- Read [`docs/releasing.md`](docs/releasing.md) next for the tagged artifact and consumer-adoption gates.

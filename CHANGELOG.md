# Changelog

## 0.1.0 - 2026-08-16

- Initial portable server definitions, stateless Node adapter, Auth0 resource-server support, and
  packed consumer test kit.

## Agent guidance

- `package.json`, `scripts/check-release.mjs`, and `.github/workflows/release.yml` own version and artifact behavior.
- Preserve the public `@jtkw/mcp-kit` name, npm registry, and access settings; never work around a release failure by renaming the package or reusing a published version.
- Verify release inputs with `pnpm release:check -- v<version> && pnpm verify`.
- Read [`docs/releasing.md`](docs/releasing.md) next for the tagged artifact and consumer-adoption gates.

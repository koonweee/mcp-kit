# Changelog

## 0.1.0 - 2026-08-16

- Initial portable server definitions, stateless Node adapter, Auth0 resource-server support, and
  packed consumer test kit.

## Agent guidance

- `package.json`, `scripts/check-release.mjs`, and `.github/workflows/release.yml` own version and artifact behavior.
- Do not publish until the private registry and `@jtkw` scope are confirmed and `private` is removed deliberately.
- Verify release inputs with `pnpm release:check -- v<version> && pnpm verify`.
- Read [`docs/releasing.md`](docs/releasing.md) next for the tagged artifact and consumer-adoption gates.

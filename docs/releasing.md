# Releasing and adopting

Keep `package.json` private until the operator confirms the private registry, the `@jtkw` scope, and its authentication/provenance requirements. A `vX.Y.Z` tag must match `package.json` and a dated `CHANGELOG.md` entry; `pnpm release:check -- vX.Y.Z` enforces that contract. The release workflow always builds and uploads the inspected tarball, while registry publication remains disabled unless `NPM_PUBLISH_ENABLED` is explicitly set and `private` is deliberately removed.

## First consumer checklist

Adopt a released version only in the service's own repository, after the packed neutral consumer passes here:

1. Pin an exact `@jtkw/mcp-kit` version using the documented private-registry configuration; never consume a local checkout or unpinned Git branch.
2. Run the service's typecheck and tests, then build its production container from the pinned package.
3. Run authenticated MCP smoke checks through the official client: discovery, initialization, tool listing, one allowed call, and one denied call that proves the backend was not invoked.
4. Publish the service image and pin its immutable digest in the service repository and declarative Komodo stack.
5. Validate the intended Auth0 issuer, audience/resource, scopes, protected-resource metadata, and bearer challenge through the real Traefik hostname before enabling the client connection.
6. Deploy through the service's repo-backed Komodo stack, verify health and authenticated MCP behavior, and record the package version plus image digest in the rollout result.

Registry publication, Auth0 tenant mutations, consumer-repository changes, and Komodo deployment require their own explicit authorization. They are not performed by the package release workflow.

## Agent guidance

- Owning files: `package.json`, `CHANGELOG.md`, `scripts/check-release.mjs`, and `.github/workflows/release.yml` own package releases; the selected service and stack repositories own adoption and deployment.
- Preserve exact version and immutable image pinning, provenance, artifact inspection, and the authorization gates around registry, Auth0, and Komodo changes.
- Verify release inputs with `pnpm release:check -- v<version> && pnpm verify`; run the consumer's own gates and authenticated smoke before any deployment.
- Read [Architecture](architecture.md) next for compatibility boundaries and [Auth0](auth0.md) for the tenant and resource-server contract.

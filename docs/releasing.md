# Releasing and adopting

`@jtkw/mcp-kit` is a public package on the npm registry. A `vX.Y.Z` tag must match `package.json` and a dated `CHANGELOG.md` entry; `pnpm release:check -- vX.Y.Z` enforces that contract and the fixed package name, registry, public access, and source repository.

## One-time npm and GitHub setup

The `@jtkw` npm user or organization must exist and the release operator must be allowed to publish in that scope. Do not rename the package if the scope is unavailable: create the `jtkw` npm user or organization, or grant the operator publish access, then continue with the same package name.

npm trusted publishers are configured from an existing package's settings, so the first version needs a temporary bootstrap credential:

1. Enable two-factor authentication on the npm operator account. Create a short-lived granular npm token with read/write publication access and 2FA bypass, restricted to the `@jtkw` scope when npm offers that choice.
2. Add the token as the `NPM_TOKEN` Actions secret in `koonweee/mcp-kit`. Never put it in a file, command argument, issue, log, or commit.
3. Push the fully validated first tag. The release workflow publishes with npm CLI 11.12.1 on a GitHub-hosted runner; npm uses trusted-publisher OIDC first and falls back to `NPM_TOKEN` only while no trusted publisher exists.
4. In the new package's npm settings, add a GitHub Actions trusted publisher with organization/user `koonweee`, repository `mcp-kit`, workflow filename `release.yml`, no environment, and the `npm publish` action allowed.
5. Delete the GitHub `NPM_TOKEN` secret and revoke the npm token. In npm publishing access, require two-factor authentication and disallow token-based publishing.

Future releases need no npm credential. The workflow already grants only `contents: read` and `id-token: write`, uses the public npm registry, and publishes through short-lived OIDC authentication. npm automatically attaches provenance for a public package when the source GitHub repository is also public. GitHub repository visibility is a separate decision; a private source repository can use trusted publishing but npm will not generate provenance for it.

## Normal release flow

1. Confirm the target version does not already exist: `npm view @jtkw/mcp-kit@X.Y.Z version`. An `E404` is the expected result for an unused version.
2. On `main`, update `package.json` and add a dated `CHANGELOG.md` entry. Do not change the package name, reuse a published version, or create a substitute version to bypass a failure.
3. Run `pnpm release:check -- vX.Y.Z` and `pnpm verify` from a clean install. Review the packed file list and diff, then commit and push.
4. Wait for the branch CI workflow to pass. Create an annotated `vX.Y.Z` tag on that exact commit and push the tag.
5. Watch the Release workflow. After it succeeds, run `pnpm test:registry -- vX.Y.Z` or independently install the exact version and import all four public subpaths.

The tag-triggered workflow repeats `release:check` and the full `verify` gate, creates the inspected tarball, uploads it as the `mcp-kit-package` GitHub Actions artifact, publishes that exact tarball publicly to npm, and verifies registry metadata, integrity, installation, and imports. It does not change package versions, create tags, create GitHub Releases, or deploy consumers.

## Failure recovery

- If authentication fails before npm accepts the package, correct the npm scope access, bootstrap secret, or trusted-publisher fields and rerun the same failed workflow. The trusted-publisher repository and workflow filename are case-sensitive.
- If a code or metadata gate fails and `npm view @jtkw/mcp-kit@X.Y.Z version` still returns `E404`, delete only the unpublished release tag, fix and validate `main`, then recreate that version's tag on the corrected commit.
- If npm accepted the version but a later verification step failed, do not publish or overwrite that version again. Inspect the registry package, rerun `pnpm test:registry -- vX.Y.Z`, and treat a real artifact defect as a normal subsequent semantic-versioned fix.
- If npm reports a version conflict, stop and inspect the existing registry artifact. Never overwrite it and never invent a different version merely to make the workflow green.
- The Actions tarball is retained for inspection even when publication fails. Compare it with `npm pack --dry-run` and `pnpm pack:check` before retrying.

## First consumer checklist

Adopt a released version only in the service's own repository, after the packed neutral consumer and registry checks pass here:

1. Pin an exact public npm version; never consume a local checkout or unpinned Git branch.
2. Run the service's typecheck and tests, then build its production container from the pinned package.
3. Run authenticated MCP smoke checks through the official client: discovery, initialization, tool listing, one allowed call, and one denied call that proves the backend was not invoked.
4. Publish the service image and pin its immutable digest in the service repository and declarative Komodo stack.
5. Validate the intended Auth0 issuer, audience/resource, scopes, protected-resource metadata, and bearer challenge through the real Traefik hostname before enabling the client connection.
6. Deploy through the service's repo-backed Komodo stack, verify health and authenticated MCP behavior, and record the package version plus image digest in the rollout result.

Consumer-repository changes, Auth0 tenant mutations, and Komodo deployment require their own explicit authorization. They are not performed by the package release workflow.

## Agent guidance

- Owning files: `package.json`, `CHANGELOG.md`, `scripts/check-release.mjs`, `scripts/test-registry.mjs`, and `.github/workflows/release.yml` own package releases; the selected service and stack repositories own adoption and deployment.
- Preserve the exact public `@jtkw/mcp-kit` name, public npm registry, immutable versions, OIDC trusted publishing, artifact inspection, and authorization gates around repository visibility, Auth0, consumers, and Komodo.
- For a release, prove the version is unused, run `pnpm release:check -- v<version>` and `pnpm verify`, wait for branch CI, and tag only the validated commit. After publication run `pnpm test:registry -- v<version>`.
- Never commit or print npm credentials, overwrite an npm version, or publish a different version to evade a partial failure.
- Read [Architecture](architecture.md) next for compatibility boundaries and [Auth0](auth0.md) for the tenant and resource-server contract.

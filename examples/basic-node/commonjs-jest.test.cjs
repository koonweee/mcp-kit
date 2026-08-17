'use strict';

/* global expect, test */

const { createAuth0Verifier } = require('@koonweee/mcp-kit/auth0');
const { createTestJwtAuthority } = require('@koonweee/mcp-kit/test');

test('authenticates through the packed CommonJS surface without VM module flags', async () => {
  const authority = await createTestJwtAuthority();
  const verifier = createAuth0Verifier({
    issuer: authority.issuer,
    audience: authority.audience,
    jwksUri: authority.jwksUri,
    jwks: { fetch: authority.fetch, cooldownMs: 0 },
  });
  const token = await authority.sign({ subject: 'jest-user', scope: 'example:read' });

  await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
    scopes: ['example:read'],
    extra: { subject: 'jest-user' },
  });
});

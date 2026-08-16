import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { createAuth0Verifier } from '../../src/auth0/index.js';
import { createTestJwtAuthority } from '../../src/test/index.js';

describe('Auth0 verifier', () => {
  it('validates exact issuer/audience and normalizes subject, client, and scopes', async () => {
    const authority = await createTestJwtAuthority({ audience: 'https://api.example' });
    const verifier = createAuth0Verifier({
      issuer: authority.issuer,
      audience: authority.audience,
      jwksUri: authority.jwksUri,
      jwks: { fetch: authority.fetch },
    });
    const token = await authority.sign({ scope: 'write read read', clientId: 'client-1' });
    const info = await verifier.verifyAccessToken(token);
    expect(info).toMatchObject({
      clientId: 'client-1',
      scopes: ['read', 'write'],
      extra: { subject: 'test-user' },
    });
    expect(info.resource?.href).toBe('https://api.example/');
  });

  it.each([
    ['wrong issuer', { issuer: 'https://wrong.example/' }],
    ['wrong audience', { audience: 'https://wrong.example/mcp' }],
    ['expired', { expiresInSeconds: -60 }],
    ['missing subject', { omitSubject: true }],
    ['empty subject', { subject: '' }],
    ['missing expiration', { omitExpiration: true }],
    ['malformed scope', { extra: { scope: ['read'] } }],
  ] as const)('rejects %s with one generic invalid-token error', async (_label, claims) => {
    const authority = await createTestJwtAuthority();
    const verifier = createAuth0Verifier({
      issuer: authority.issuer,
      audience: authority.audience,
      jwksUri: authority.jwksUri,
      clockToleranceSeconds: 0,
      jwks: { fetch: authority.fetch },
    });
    await expect(verifier.verifyAccessToken(await authority.sign(claims))).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
      message: 'Invalid access token',
    });
  });

  it('rejects a token signed by an unrelated key and does not leak it', async () => {
    const trusted = await createTestJwtAuthority();
    const unrelated = await createTestJwtAuthority();
    const verifier = createAuth0Verifier({
      issuer: trusted.issuer,
      audience: trusted.audience,
      jwksUri: trusted.jwksUri,
      jwks: { fetch: trusted.fetch },
    });
    const token = await unrelated.sign();
    let failure: unknown;
    try {
      await verifier.verifyAccessToken(token);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(OAuthError);
    expect((failure as OAuthError).code).toBe(OAuthErrorCode.InvalidToken);
    expect(JSON.stringify(failure)).not.toContain(token);
  });

  it('reloads a bounded JWKS cache for key rotation', async () => {
    const authority = await createTestJwtAuthority();
    let fetches = 0;
    const verifier = createAuth0Verifier({
      issuer: authority.issuer,
      audience: authority.audience,
      jwksUri: authority.jwksUri,
      jwks: {
        cooldownMs: 0,
        fetch: async (...args) => {
          fetches += 1;
          return authority.fetch(...args);
        },
      },
    });
    await verifier.verifyAccessToken(await authority.sign());
    expect(fetches).toBe(1);
    await authority.rotate();
    await verifier.verifyAccessToken(await authority.sign());
    expect(fetches).toBe(2);
    await verifier.verifyAccessToken(await authority.sign());
    expect(fetches).toBe(2);
  });

  it('accepts a valid token with no scopes for later policy denial', async () => {
    const authority = await createTestJwtAuthority();
    const verifier = createAuth0Verifier({
      issuer: authority.issuer,
      audience: authority.audience,
      jwksUri: authority.jwksUri,
      jwks: { fetch: authority.fetch },
    });
    expect((await verifier.verifyAccessToken(await authority.sign())).scopes).toEqual([]);
  });

  it('reports JWKS infrastructure failures as server errors', async () => {
    const authority = await createTestJwtAuthority();
    const verifier = createAuth0Verifier({
      issuer: authority.issuer,
      audience: authority.audience,
      jwksUri: authority.jwksUri,
      jwks: {
        fetch: () => Promise.reject(new TypeError('fetch failed')),
      },
    });
    await expect(verifier.verifyAccessToken(await authority.sign())).rejects.toMatchObject({
      code: OAuthErrorCode.ServerError,
      message: 'Token verification unavailable',
    });
  });
});

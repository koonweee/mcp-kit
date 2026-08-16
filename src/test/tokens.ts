import type { FetchImplementation, JWK } from 'jose';
import { loadJose } from '../shared/jose-loader.cjs';

/** Claims accepted by the ephemeral RS256 authority. */
export interface TestTokenClaims {
  readonly subject?: string;
  readonly audience?: string | readonly string[];
  readonly scope?: string;
  readonly clientId?: string;
  readonly authorizedParty?: string;
  readonly expiresInSeconds?: number;
  readonly omitSubject?: boolean;
  readonly omitExpiration?: boolean;
  readonly issuer?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** Ephemeral signing authority. Private keys remain closure-local and are never exported. */
export interface TestJwtAuthority {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly fetch: FetchImplementation;
  sign(claims?: TestTokenClaims): Promise<string>;
  rotate(options?: { readonly retainPrevious?: boolean }): Promise<void>;
  jwks(): { readonly keys: readonly JWK[] };
}

interface SigningKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
}

async function signingKey(kid: string): Promise<SigningKey> {
  const { exportJWK, generateKeyPair } = await loadJose();
  const pair = await generateKeyPair('RS256', { extractable: true });
  return {
    kid,
    privateKey: pair.privateKey,
    publicJwk: { ...(await exportJWK(pair.publicKey)), kid, alg: 'RS256', use: 'sig' },
  };
}

/** Creates an in-memory JWKS endpoint with signing and rotation controls for tests. */
export async function createTestJwtAuthority(
  options: {
    readonly issuer?: string;
    readonly audience?: string;
  } = {},
): Promise<TestJwtAuthority> {
  const issuer = options.issuer ?? 'https://issuer.example/';
  const audience = options.audience ?? 'https://mcp.example/mcp';
  const jwksUri = new URL('.well-known/jwks.json', issuer).href;
  let sequence = 0;
  let current = await signingKey(`test-key-${sequence}`);
  let published: SigningKey[] = [current];

  return {
    issuer,
    audience,
    jwksUri,
    fetch: () => Promise.resolve(Response.json({ keys: published.map((key) => key.publicJwk) })),
    async sign(claims = {}) {
      const { SignJWT } = await loadJose();
      const now = Math.floor(Date.now() / 1_000);
      const tokenAudience: string | string[] =
        typeof claims.audience === 'string' || claims.audience === undefined
          ? (claims.audience ?? audience)
          : [...claims.audience];
      let token = new SignJWT({
        ...(claims.scope !== undefined ? { scope: claims.scope } : {}),
        ...(claims.clientId ? { client_id: claims.clientId } : {}),
        ...(claims.authorizedParty ? { azp: claims.authorizedParty } : {}),
        ...claims.extra,
      })
        .setProtectedHeader({ alg: 'RS256', kid: current.kid, typ: 'JWT' })
        .setIssuer(claims.issuer ?? issuer)
        .setAudience(tokenAudience)
        .setIssuedAt(now);
      if (claims.omitSubject !== true) {
        token = token.setSubject(claims.subject ?? 'test-user');
      }
      if (claims.omitExpiration !== true) {
        token = token.setExpirationTime(now + (claims.expiresInSeconds ?? 300));
      }
      return token.sign(current.privateKey);
    },
    async rotate(rotation = {}) {
      sequence += 1;
      const next = await signingKey(`test-key-${sequence}`);
      published = rotation.retainPrevious === false ? [next] : [...published, next];
      current = next;
    },
    jwks: () => ({ keys: published.map((key) => key.publicJwk) }),
  };
}

import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { createRemoteJWKSet, customFetch, errors, jwtVerify, type FetchImplementation } from 'jose';

/** Bounded, injectable JWKS cache settings. Public keys are cached; tokens never are. */
export interface Auth0JwksOptions {
  readonly timeoutMs?: number;
  readonly cooldownMs?: number;
  readonly cacheMaxAgeMs?: number;
  readonly fetch?: FetchImplementation;
}

/** Trusted Auth0 resource-server configuration. */
export interface Auth0VerifierOptions {
  readonly issuer: string | URL;
  readonly audience: string | URL;
  readonly jwksUri?: string | URL;
  readonly clockToleranceSeconds?: number;
  readonly jwks?: Auth0JwksOptions;
  readonly dangerouslyAllowInsecureIssuerUrl?: boolean;
}

const invalidTokenCodes = new Set([
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWT_INVALID',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_EXPIRED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
]);

class InvalidTokenClaimError extends Error {}

function trustedUrl(value: string | URL, label: string): URL {
  const url = new URL(value);
  if (url.hash || url.search) throw new TypeError(`${label} must not include a query or fragment`);
  return url;
}

function normalizeIssuer(options: Auth0VerifierOptions): URL {
  const issuer = trustedUrl(options.issuer, 'issuer');
  if (
    issuer.protocol !== 'https:' &&
    !(
      options.dangerouslyAllowInsecureIssuerUrl === true &&
      (issuer.hostname === 'localhost' ||
        issuer.hostname === '127.0.0.1' ||
        issuer.hostname === '[::1]')
    )
  ) {
    throw new TypeError('issuer must use HTTPS');
  }
  if (!issuer.pathname.endsWith('/')) issuer.pathname += '/';
  return issuer;
}

function isLocalhost(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

function normalizeScopes(scope: unknown): string[] {
  if (scope === undefined) return [];
  if (typeof scope !== 'string') throw new InvalidTokenClaimError('scope claim must be a string');
  return [...new Set(scope.split(/\s+/u).filter(Boolean))].sort();
}

function nonEmptyClaim(payload: Record<string, unknown>, name: string): string | undefined {
  const value = payload[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function oauthFailure(error: unknown): OAuthError {
  if (error instanceof errors.JOSEError && invalidTokenCodes.has(error.code)) {
    return new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid access token');
  }
  if (error instanceof InvalidTokenClaimError) {
    return new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid access token');
  }
  return new OAuthError(OAuthErrorCode.ServerError, 'Token verification unavailable');
}

/** Creates a reusable Auth0 JWT verifier with a bounded remote-JWKS cache. */
export function createAuth0Verifier(options: Auth0VerifierOptions): OAuthTokenVerifier {
  const issuer = normalizeIssuer(options);
  const audienceValue = options.audience instanceof URL ? options.audience.href : options.audience;
  const audience = trustedUrl(audienceValue, 'audience');
  const jwksUri = options.jwksUri
    ? trustedUrl(options.jwksUri, 'jwksUri')
    : new URL('.well-known/jwks.json', issuer);
  if (
    jwksUri.protocol !== 'https:' &&
    !(options.dangerouslyAllowInsecureIssuerUrl === true && isLocalhost(jwksUri))
  ) {
    throw new TypeError('jwksUri must use HTTPS');
  }

  const fetchImplementation = options.jwks?.fetch;
  const jwks = createRemoteJWKSet(jwksUri, {
    timeoutDuration: options.jwks?.timeoutMs ?? 5_000,
    cooldownDuration: options.jwks?.cooldownMs ?? 30_000,
    cacheMaxAge: options.jwks?.cacheMaxAgeMs ?? 600_000,
    ...(fetchImplementation ? { [customFetch]: fetchImplementation } : {}),
  });

  return Object.freeze<OAuthTokenVerifier>({
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          algorithms: ['RS256'],
          issuer: issuer.href,
          audience: audienceValue,
          requiredClaims: ['exp', 'sub'],
          clockTolerance: options.clockToleranceSeconds ?? 5,
        });
        const subject = nonEmptyClaim(payload, 'sub');
        if (!subject || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
          throw new InvalidTokenClaimError('required claims are invalid');
        }
        const clientId =
          nonEmptyClaim(payload, 'client_id') ?? nonEmptyClaim(payload, 'azp') ?? subject;
        return {
          token,
          clientId,
          scopes: normalizeScopes(payload['scope']),
          expiresAt: payload.exp,
          resource: new URL(audience),
          extra: { subject },
        };
      } catch (error) {
        throw oauthFailure(error);
      }
    },
  });
}

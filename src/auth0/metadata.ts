import {
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  type OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/server';

/** Protected-resource metadata configuration for one public MCP endpoint. */
export interface Auth0ProtectedResourceOptions {
  readonly issuer: string | URL;
  readonly resourceServerUrl: string | URL;
  readonly scopesSupported?: readonly string[];
  readonly resourceName?: string;
  readonly serviceDocumentationUrl?: string | URL;
  readonly dangerouslyAllowInsecureIssuerUrl?: boolean;
}

function metadataOptions(options: Auth0ProtectedResourceOptions) {
  const issuer = new URL(options.issuer);
  if (!issuer.pathname.endsWith('/')) issuer.pathname += '/';
  return {
    oauthMetadata: {
      issuer: issuer.href,
      authorization_endpoint: new URL('authorize', issuer).href,
      token_endpoint: new URL('oauth/token', issuer).href,
      response_types_supported: ['code'],
    },
    resourceServerUrl: new URL(options.resourceServerUrl),
    ...(options.scopesSupported ? { scopesSupported: [...options.scopesSupported] } : {}),
    ...(options.resourceName ? { resourceName: options.resourceName } : {}),
    ...(options.serviceDocumentationUrl
      ? { serviceDocumentationUrl: new URL(options.serviceDocumentationUrl) }
      : {}),
    ...(options.dangerouslyAllowInsecureIssuerUrl === true
      ? { dangerouslyAllowInsecureIssuerUrl: true }
      : {}),
  };
}

/** Builds standards-compliant RFC 9728 metadata identifying Auth0 as the authorization server. */
export function createAuth0ProtectedResourceMetadata(
  options: Auth0ProtectedResourceOptions,
): OAuthProtectedResourceMetadata {
  return buildOAuthProtectedResourceMetadata(metadataOptions(options));
}

/** Returns the path-aware protected-resource metadata URL for an MCP resource. */
export function getAuth0ProtectedResourceMetadataUrl(resourceServerUrl: string | URL): string {
  return getOAuthProtectedResourceMetadataUrl(new URL(resourceServerUrl));
}

/** Creates a small Web handler for the resource's RFC 9728 discovery document. */
export function createAuth0ProtectedResourceHandler(options: Auth0ProtectedResourceOptions) {
  const metadata = createAuth0ProtectedResourceMetadata(options);
  const metadataUrl = new URL(getAuth0ProtectedResourceMetadataUrl(options.resourceServerUrl));
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'content-type': 'application/json',
  };

  return (request: Request): Response | undefined => {
    if (new URL(request.url).pathname !== metadataUrl.pathname) return undefined;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, {
        status: 405,
        headers: { ...headers, allow: 'GET, HEAD, OPTIONS' },
      });
    }
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(metadata), {
      status: 200,
      headers,
    });
  };
}

import {
  createAuth0BearerGate,
  createAuth0ProtectedResourceHandler,
  createAuth0ProtectedResourceMetadata,
  createAuth0Verifier,
  getAuth0ProtectedResourceMetadataUrl,
} from '../../src/auth0/index.js';
import { createTestJwtAuthority } from '../../src/test/index.js';

describe('Auth0 resource-server discovery and bearer gate', () => {
  const resource = 'https://mcp.example/services/demo/mcp';
  const issuer = 'https://tenant.example/';

  it('builds path-aware RFC 9728 metadata', () => {
    expect(getAuth0ProtectedResourceMetadataUrl(resource)).toBe(
      'https://mcp.example/.well-known/oauth-protected-resource/services/demo/mcp',
    );
    expect(
      createAuth0ProtectedResourceMetadata({
        issuer,
        resourceServerUrl: resource,
        scopesSupported: ['read', 'write'],
        resourceName: 'Demo MCP',
      }),
    ).toMatchObject({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ['read', 'write'],
      resource_name: 'Demo MCP',
    });
  });

  it('serves GET/HEAD/OPTIONS and rejects mutation of metadata', () => {
    const handler = createAuth0ProtectedResourceHandler({ issuer, resourceServerUrl: resource });
    const url = getAuth0ProtectedResourceMetadataUrl(resource);
    expect(handler(new Request(url))?.status).toBe(200);
    expect(handler(new Request(url, { method: 'HEAD' }))?.status).toBe(200);
    expect(handler(new Request(url, { method: 'OPTIONS' }))?.status).toBe(204);
    const rejected = handler(new Request(url, { method: 'POST' }));
    expect(rejected?.status).toBe(405);
    expect(rejected?.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    expect(handler(new Request('https://mcp.example/elsewhere'))).toBeUndefined();
  });

  it('returns discoverable 401 and insufficient-scope 403 challenges', async () => {
    const authority = await createTestJwtAuthority();
    const metadataUrl = getAuth0ProtectedResourceMetadataUrl(authority.audience);
    const verifier = createAuth0Verifier({
      issuer: authority.issuer,
      audience: authority.audience,
      jwksUri: authority.jwksUri,
      jwks: { fetch: authority.fetch },
    });
    const gate = createAuth0BearerGate({
      verifier,
      requiredScopes: ['mcp:read'],
      resourceMetadataUrl: metadataUrl,
    });

    const missing = await gate(new Request(authority.audience));
    expect(missing).toBeInstanceOf(Response);
    expect((missing as Response).status).toBe(401);
    expect((missing as Response).headers.get('www-authenticate')).toContain(
      `resource_metadata="${metadataUrl}"`,
    );

    const denied = await gate(
      new Request(authority.audience, {
        headers: { authorization: `Bearer ${await authority.sign({ scope: 'other' })}` },
      }),
    );
    expect(denied).toBeInstanceOf(Response);
    expect((denied as Response).status).toBe(403);
    expect((denied as Response).headers.get('www-authenticate')).toContain(
      'error="insufficient_scope"',
    );
    expect((denied as Response).headers.get('www-authenticate')).toContain('scope="mcp:read"');
  });
});

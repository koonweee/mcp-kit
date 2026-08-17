import { expectTypeOf } from 'vitest';
import { z } from 'zod/v4';
import {
  MCP_APP_RESOURCE_MIME_TYPE,
  createRequestContext,
  defineAppResource,
  defineServer,
  defineTool,
  silentLogger,
  validateMcpApps,
  type McpRequestContext,
} from '../../src/index.js';
import { connectInMemory } from '../../src/test/index.js';

interface Dependencies {
  readonly label: string;
}

const sharedOrigin = 'https://widgets.example.com';

function resource(name: string, version: string) {
  return defineAppResource<Dependencies>()({
    name,
    uri: `ui://${name}/${version}.html`,
    title: `${name} UI`,
    description: `Interactive ${name}`,
    ui: {
      domain: sharedOrigin,
      prefersBorder: true,
      csp: {
        connectDomains: ['https://api.example.com'],
        resourceDomains: ['https://static.example.com'],
        frameDomains: ['https://frames.example.com'],
        baseUriDomains: ['https://base.example.com'],
      },
    },
    html(context) {
      expectTypeOf(context).toEqualTypeOf<McpRequestContext<Dependencies>>();
      return `<!doctype html><html><body>${context.dependencies.label}:${name}</body></html>`;
    },
  });
}

describe('MCP Apps definitions', () => {
  it('serializes standard resource and tool metadata through official SDK shapes', async () => {
    const dashboard = resource('dashboard', 'v1');
    const details = resource('details', 'v2');
    const tool = defineTool<Dependencies>()({
      name: 'show-dashboard',
      description: 'Show a portable dashboard',
      inputSchema: z.object({}),
      outputSchema: z.object({ label: z.string() }),
      _meta: { 'example.dev/extension': true },
      ui: { resourceUri: dashboard.uri, visibility: ['model', 'app'] },
      requiredScopes: [],
      risk: { kind: 'read' },
      handler(_input, context) {
        return {
          content: [{ type: 'text', text: `Dashboard: ${context.dependencies.label}` }],
          structuredContent: { label: context.dependencies.label },
        };
      },
    });
    const definition = defineServer<Dependencies>()({
      name: 'apps-test',
      version: '1.0.0',
      apps: { resources: [dashboard, details] },
      tools: [tool],
    });

    expect(() => {
      validateMcpApps(definition, { profile: 'openai-submission' });
    }).not.toThrow();
    const connected = await connectInMemory(
      definition,
      createRequestContext({
        requestId: 'apps-standard',
        logger: silentLogger,
        dependencies: { label: 'ready' },
      }),
    );
    try {
      const listedTools = await connected.client.listTools();
      expect(listedTools.tools[0]?._meta).toEqual({
        'example.dev/extension': true,
        ui: {
          resourceUri: 'ui://dashboard/v1.html',
          visibility: ['model', 'app'],
        },
      });
      const listedResources = await connected.client.listResources();
      const listedDashboard = listedResources.resources.find(
        (candidate) => candidate.uri === dashboard.uri,
      );
      expect(listedDashboard).toMatchObject({
        name: 'dashboard',
        uri: dashboard.uri,
        mimeType: MCP_APP_RESOURCE_MIME_TYPE,
      });
      expect(listedDashboard?._meta?.['ui']).toMatchObject({
        domain: sharedOrigin,
        prefersBorder: true,
      });
      expect(listedResources.resources).toContainEqual(
        expect.objectContaining({
          name: 'details',
          uri: details.uri,
          mimeType: MCP_APP_RESOURCE_MIME_TYPE,
        }),
      );
      const read = await connected.client.readResource({ uri: dashboard.uri });
      expect(read.contents).toEqual([
        {
          uri: dashboard.uri,
          mimeType: MCP_APP_RESOURCE_MIME_TYPE,
          text: '<!doctype html><html><body>ready:dashboard</body></html>',
          _meta: {
            ui: {
              domain: sharedOrigin,
              prefersBorder: true,
              csp: {
                connectDomains: ['https://api.example.com'],
                resourceDomains: ['https://static.example.com'],
                frameDomains: ['https://frames.example.com'],
                baseUriDomains: ['https://base.example.com'],
              },
            },
          },
        },
      ]);

      // An ordinary client that never renders the resource still receives complete fallbacks.
      await expect(
        connected.client.callTool({ name: tool.name, arguments: {} }),
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: 'Dashboard: ready' }],
        structuredContent: { label: 'ready' },
      });
    } finally {
      await connected.close();
    }
  });

  it('emits legacy ChatGPT aliases only when explicitly enabled and keeps standards authoritative', async () => {
    const dashboard = defineAppResource<Dependencies>()({
      ...resource('compatible', 'v1'),
      _meta: {
        ui: { domain: 'https://ignored.example.com', extension: true },
        'openai/widgetDomain': 'https://ignored.example.com',
        'openai/widgetCSP': {
          connect_domains: ['https://ignored-api.example.com'],
          redirect_domains: ['https://checkout.example.com'],
        },
      },
    });
    const rawCompatible = defineAppResource<Dependencies>()({
      name: 'raw-compatible',
      uri: 'ui://raw-compatible/v1.html',
      _meta: {
        ui: {
          domain: sharedOrigin,
          csp: {
            connectDomains: ['https://raw-api.example.com'],
            resourceDomains: ['https://raw-static.example.com'],
          },
          prefersBorder: false,
        },
        'openai/widgetCSP': { redirect_domains: ['https://raw-checkout.example.com'] },
      },
      html: '<!doctype html><html><body>raw compatible</body></html>',
    });
    const tool = defineTool<Dependencies>()({
      name: 'compatible-tool',
      description: 'Exercise explicit compatibility metadata',
      inputSchema: z.object({}),
      _meta: {
        ui: { resourceUri: 'ui://ignored/template.html', extension: true },
        'openai/outputTemplate': 'ui://ignored/template.html',
      },
      ui: { resourceUri: dashboard.uri },
      requiredScopes: [],
      risk: { kind: 'read' },
      handler: () => ({ content: [{ type: 'text', text: 'compatible fallback' }] }),
    });
    const definition = defineServer<Dependencies>()({
      name: 'compatibility-test',
      version: '1.0.0',
      apps: {
        resources: [dashboard, rawCompatible],
        compatibility: { openaiLegacyAliases: true },
      },
      tools: [tool],
    });
    const connected = await connectInMemory(
      definition,
      createRequestContext({
        requestId: 'apps-compatibility',
        logger: silentLogger,
        dependencies: { label: 'ready' },
      }),
    );
    try {
      const listed = await connected.client.listTools();
      expect(listed.tools[0]?._meta).toMatchObject({
        ui: { resourceUri: dashboard.uri, extension: true },
        'openai/outputTemplate': dashboard.uri,
      });
      const listedResources = await connected.client.listResources();
      expect(listedResources.resources[0]?._meta?.['openai/widgetCSP']).toEqual({
        connect_domains: ['https://api.example.com'],
        resource_domains: ['https://static.example.com'],
        frame_domains: ['https://frames.example.com'],
        redirect_domains: ['https://checkout.example.com'],
      });
      const listedRaw = listedResources.resources.find(
        (candidate) => candidate.uri === rawCompatible.uri,
      );
      expect(listedRaw?._meta).toMatchObject({
        'openai/widgetDomain': sharedOrigin,
        'openai/widgetPrefersBorder': false,
        'openai/widgetCSP': {
          connect_domains: ['https://raw-api.example.com'],
          resource_domains: ['https://raw-static.example.com'],
          redirect_domains: ['https://raw-checkout.example.com'],
        },
      });
      const read = await connected.client.readResource({ uri: dashboard.uri });
      expect(read.contents[0]?._meta).toMatchObject({
        ui: {
          domain: sharedOrigin,
          extension: true,
          prefersBorder: true,
        },
        'openai/widgetDomain': sharedOrigin,
        'openai/widgetPrefersBorder': true,
        'openai/widgetCSP': {
          connect_domains: ['https://api.example.com'],
          resource_domains: ['https://static.example.com'],
          frame_domains: ['https://frames.example.com'],
          redirect_domains: ['https://checkout.example.com'],
        },
      });
      const rawRead = await connected.client.readResource({ uri: rawCompatible.uri });
      expect(rawRead.contents[0]?._meta).toMatchObject(listedRaw?._meta ?? {});
    } finally {
      await connected.close();
    }
  });

  it.each([
    'http://widgets.example.com',
    'https://widgets.example.com/',
    'https://widgets.example.com/path',
    'https://widgets.example.com?query=yes',
    'https://widgets.example.com#fragment',
    'https://WIDGETS.example.com',
    'https://widgets.example.com:443',
  ])('rejects non-canonical UI origins: %s', (domain) => {
    expect(() =>
      defineAppResource<Dependencies>()({
        name: 'invalid-origin',
        uri: 'ui://invalid/origin.html',
        ui: { domain },
        html: '<!doctype html><html></html>',
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: 'invalid_domain' })],
      }),
    );
  });

  it('keeps domains optional for portable definitions but requires one for OpenAI submission', () => {
    const dashboard = defineAppResource<Dependencies>()({
      name: 'portable-only',
      uri: 'ui://portable-only/v1.html',
      ui: { prefersBorder: false },
      html: '<!doctype html><html></html>',
    });
    const definition = defineServer<Dependencies>()({
      name: 'portable-only',
      version: '1.0.0',
      apps: { resources: [dashboard] },
      tools: [],
    });

    expect(() => {
      validateMcpApps(definition);
    }).not.toThrow();
    expect(() => {
      validateMcpApps(definition, { profile: 'openai-submission' });
    }).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: 'missing_openai_domain' })],
      }),
    );
  });

  it('validates effective raw metadata while typed fields remain authoritative', () => {
    expect(() =>
      defineAppResource<Dependencies>()({
        name: 'invalid-raw-origin',
        uri: 'ui://invalid-raw/origin.html',
        _meta: { ui: { domain: 'http://widgets.example.com/path' } },
        html: '<!doctype html><html></html>',
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: 'invalid_domain' })],
      }),
    );
    expect(() =>
      defineAppResource<Dependencies>()({
        name: 'invalid-raw-container',
        uri: 'ui://invalid-raw/container.html',
        _meta: { ui: 'invalid' },
        html: '<!doctype html><html></html>',
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: 'invalid_ui_metadata' })],
      }),
    );

    const rawDomain = defineAppResource<Dependencies>()({
      name: 'raw-domain',
      uri: 'ui://raw-domain/v1.html',
      _meta: { ui: { domain: sharedOrigin } },
      html: '<!doctype html><html></html>',
    });
    const typedOverride = defineAppResource<Dependencies>()({
      name: 'typed-domain',
      uri: 'ui://typed-domain/v1.html',
      _meta: { ui: 'ignored because typed metadata replaces it' },
      ui: { domain: sharedOrigin },
      html: '<!doctype html><html></html>',
    });
    const definition = defineServer<Dependencies>()({
      name: 'effective-metadata',
      version: '1.0.0',
      apps: { resources: [rawDomain, typedOverride] },
      tools: [],
    });

    expect(() => {
      validateMcpApps(definition, { profile: 'openai-submission' });
    }).not.toThrow();
  });

  it('rejects broken tool/resource linkage before a server can start', () => {
    const broken = defineTool<Dependencies>()({
      name: 'broken-link',
      description: 'References a resource that is not registered',
      inputSchema: z.object({}),
      ui: { resourceUri: 'ui://missing/template.html' },
      requiredScopes: [],
      risk: { kind: 'read' },
      handler: () => ({ content: [{ type: 'text', text: 'fallback' }] }),
    });

    expect(() =>
      defineServer<Dependencies>()({
        name: 'broken-link',
        version: '1.0.0',
        apps: { resources: [] },
        tools: [broken],
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: 'unregistered_tool_resource' })],
      }),
    );
  });

  it('rejects dangling links supplied through raw standard metadata without an apps block', () => {
    const rawLink = defineTool<Dependencies>()({
      name: 'raw-broken-link',
      description: 'References a resource through raw standard metadata',
      inputSchema: z.object({}),
      _meta: { ui: { resourceUri: 'ui://missing/raw-template.html' } },
      requiredScopes: [],
      risk: { kind: 'read' },
      handler: () => ({ content: [{ type: 'text', text: 'fallback' }] }),
    });

    expect(() =>
      defineServer<Dependencies>()({
        name: 'raw-broken-link',
        version: '1.0.0',
        tools: [rawLink],
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: 'unregistered_tool_resource' })],
      }),
    );
  });

  it.each([
    { ui: { visibility: ['invalid'] }, code: 'invalid_ui_metadata' },
    { ui: 'invalid', code: 'invalid_ui_metadata' },
    { ui: null, code: 'invalid_ui_metadata' },
  ])('rejects invalid raw-only tool metadata: $ui', ({ ui, code }) => {
    const invalid = defineTool<Dependencies>()({
      name: 'invalid-raw-tool-ui',
      description: 'Contains malformed raw UI metadata',
      inputSchema: z.object({}),
      _meta: { ui },
      requiredScopes: [],
      risk: { kind: 'read' },
      handler: () => ({ content: [{ type: 'text', text: 'fallback' }] }),
    });

    expect(() =>
      defineServer<Dependencies>()({
        name: 'invalid-raw-tool-ui',
        version: '1.0.0',
        tools: [invalid],
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code })],
      }),
    );
  });

  it('supports visibility-only app tools without a rendering resource', async () => {
    const appOnly = defineTool<Dependencies>()({
      name: 'app-only-helper',
      description: 'Called only from app UI when one is present',
      inputSchema: z.object({}),
      ui: { visibility: ['app'] },
      requiredScopes: [],
      risk: { kind: 'read' },
      handler: () => ({ content: [{ type: 'text', text: 'app helper fallback' }] }),
    });
    const definition = defineServer<Dependencies>()({
      name: 'app-only-helper',
      version: '1.0.0',
      apps: { resources: [] },
      tools: [appOnly],
    });
    const connected = await connectInMemory(
      definition,
      createRequestContext({
        requestId: 'app-only-helper',
        logger: silentLogger,
        dependencies: { label: 'ready' },
      }),
    );
    try {
      const listed = await connected.client.listTools();
      expect(listed.tools[0]?._meta?.['ui']).toEqual({ visibility: ['app'] });
      await expect(
        connected.client.callTool({ name: appOnly.name, arguments: {} }),
      ).resolves.toMatchObject({
        content: [{ type: 'text', text: 'app helper fallback' }],
      });
    } finally {
      await connected.close();
    }
  });
});

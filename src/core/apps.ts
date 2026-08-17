import { type McpServer, type MetaObject } from '@modelcontextprotocol/server';
import type { McpRequestContext } from './context.js';
import type { McpServerDefinition } from './definition.js';
import { mcpExtensionErrorBoundary } from './extensions.js';
import { enforceRequiredScopes } from './policy.js';

/** Stable MCP Apps HTML resource MIME type. */
export const MCP_APP_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app' as const;

/** Content Security Policy allowlists from the stable MCP Apps specification. */
export interface McpUiContentSecurityPolicy {
  readonly connectDomains?: readonly string[];
  readonly resourceDomains?: readonly string[];
  readonly frameDomains?: readonly string[];
  readonly baseUriDomains?: readonly string[];
}

/** Optional browser capabilities requested by an MCP App resource. */
export interface McpUiPermissions {
  readonly camera?: Readonly<Record<string, never>>;
  readonly microphone?: Readonly<Record<string, never>>;
  readonly geolocation?: Readonly<Record<string, never>>;
  readonly clipboardWrite?: Readonly<Record<string, never>>;
}

/** Standard `_meta.ui` fields emitted on MCP App resource contents. */
export interface McpUiResourceMetadata {
  readonly domain?: string;
  readonly csp?: McpUiContentSecurityPolicy;
  readonly permissions?: McpUiPermissions;
  readonly prefersBorder?: boolean;
}

/** Standard `_meta.ui` fields emitted on a tool descriptor. */
export interface McpUiToolMetadata {
  readonly resourceUri?: string;
  readonly visibility?: readonly ('model' | 'app')[];
}

/** One portable HTML resource rendered by MCP Apps-capable hosts. */
export interface McpAppResourceDefinition<TDependencies> {
  readonly name: string;
  readonly uri: string;
  readonly title?: string;
  readonly description?: string;
  readonly ui?: McpUiResourceMetadata;
  /** Server-authoritative scopes checked before the HTML provider runs. */
  readonly requiredScopes?: readonly string[];
  /** Additional resource-content metadata. Typed `ui` fields remain authoritative. */
  readonly _meta?: MetaObject;
  readonly html: string | ((context: McpRequestContext<TDependencies>) => string | Promise<string>);
}

/** Explicit compatibility behavior for hosts that predate the standard MCP Apps metadata. */
export interface McpAppsCompatibilityOptions {
  /** Emit ChatGPT's legacy `openai/*` aliases in addition to authoritative `_meta.ui` fields. */
  readonly openaiLegacyAliases?: boolean;
}

/** MCP Apps resources and compatibility behavior owned by one server definition. */
export interface McpAppsDefinition<TDependencies> {
  readonly resources: readonly McpAppResourceDefinition<TDependencies>[];
  readonly compatibility?: McpAppsCompatibilityOptions;
}

/** Validation profiles for portable use and OpenAI public plugin submission. */
export type McpAppsValidationProfile = 'portable' | 'openai-submission';

/** One actionable MCP Apps definition problem. */
export interface McpAppsValidationIssue {
  readonly code:
    | 'duplicate_resource_name'
    | 'duplicate_resource_uri'
    | 'invalid_domain'
    | 'invalid_resource_uri'
    | 'invalid_ui_metadata'
    | 'invalid_tool_resource_uri'
    | 'missing_openai_domain'
    | 'unregistered_tool_resource';
  readonly path: string;
  readonly message: string;
}

/** Raised when a portable definition cannot be serialized as a valid MCP Apps server. */
export class McpAppsValidationError extends TypeError {
  readonly issues: readonly McpAppsValidationIssue[];

  constructor(issues: readonly McpAppsValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'McpAppsValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

function canonicalHttpsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.origin === value &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
}

function validUiResourceUri(value: string): boolean {
  try {
    return new URL(value).protocol === 'ui:' && value.startsWith('ui://');
  } catch {
    return false;
  }
}

function isMetaObject(value: unknown): value is MetaObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function effectiveUiMetadata(
  metadata: MetaObject | undefined,
  typed: MetaObject | undefined,
): MetaObject {
  const raw = isMetaObject(metadata?.['ui']) ? metadata['ui'] : {};
  return { ...raw, ...typed };
}

function uiContainerIssues(
  metadata: MetaObject | undefined,
  typed: MetaObject | undefined,
  path: string,
): McpAppsValidationIssue[] {
  const raw = metadata?.['ui'];
  if (raw === undefined || typed !== undefined || isMetaObject(raw)) return [];
  return [
    {
      code: 'invalid_ui_metadata',
      path,
      message: 'MCP App ui metadata must be an object',
    },
  ];
}

function validStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function resourceMetadataIssues(ui: MetaObject, path: string): McpAppsValidationIssue[] {
  const issues: McpAppsValidationIssue[] = [];
  if (ui['domain'] !== undefined) {
    if (typeof ui['domain'] !== 'string' || !canonicalHttpsOrigin(ui['domain'])) {
      issues.push({
        code: 'invalid_domain',
        path: `${path}.domain`,
        message:
          'MCP App domains must be canonical HTTPS origins without a path, query, or fragment',
      });
    }
  }
  if (ui['prefersBorder'] !== undefined && typeof ui['prefersBorder'] !== 'boolean') {
    issues.push({
      code: 'invalid_ui_metadata',
      path: `${path}.prefersBorder`,
      message: 'MCP App prefersBorder metadata must be a boolean',
    });
  }
  if (ui['csp'] !== undefined) {
    const csp = ui['csp'];
    const keys = ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains'];
    if (!isMetaObject(csp)) {
      issues.push({
        code: 'invalid_ui_metadata',
        path: `${path}.csp`,
        message: 'MCP App CSP metadata must be an object',
      });
    } else {
      for (const key of keys) {
        if (csp[key] !== undefined && !validStringArray(csp[key])) {
          issues.push({
            code: 'invalid_ui_metadata',
            path: `${path}.csp.${key}`,
            message: `MCP App CSP ${key} must be an array of strings`,
          });
        }
      }
    }
  }
  if (ui['permissions'] !== undefined) {
    const permissions = ui['permissions'];
    if (!isMetaObject(permissions)) {
      issues.push({
        code: 'invalid_ui_metadata',
        path: `${path}.permissions`,
        message: 'MCP App permissions metadata must be an object',
      });
    } else {
      for (const key of ['camera', 'microphone', 'geolocation', 'clipboardWrite']) {
        if (permissions[key] !== undefined && !isMetaObject(permissions[key])) {
          issues.push({
            code: 'invalid_ui_metadata',
            path: `${path}.permissions.${key}`,
            message: `MCP App permission ${key} must be an object`,
          });
        }
      }
    }
  }
  return issues;
}

function resourceIssues<TDependencies>(
  resource: McpAppResourceDefinition<TDependencies>,
  index: number,
  profile: McpAppsValidationProfile,
): McpAppsValidationIssue[] {
  const path = `apps.resources[${index}]`;
  const issues: McpAppsValidationIssue[] = [];
  const typedUi = resource.ui as MetaObject | undefined;
  const ui = effectiveUiMetadata(resource._meta, typedUi);
  if (!validUiResourceUri(resource.uri)) {
    issues.push({
      code: 'invalid_resource_uri',
      path: `${path}.uri`,
      message: 'MCP App resource URIs must use the ui:// scheme',
    });
  }
  issues.push(...uiContainerIssues(resource._meta, typedUi, `${path}.ui`));
  issues.push(...resourceMetadataIssues(ui, `${path}.ui`));
  if (profile === 'openai-submission' && ui['domain'] === undefined) {
    issues.push({
      code: 'missing_openai_domain',
      path: `${path}.ui.domain`,
      message: 'OpenAI plugin submission requires a dedicated UI origin',
    });
  }
  return issues;
}

/** Curried helper that preserves request-local dependency typing for app HTML providers. */
export function defineAppResource<TDependencies>() {
  return (
    definition: McpAppResourceDefinition<TDependencies>,
  ): McpAppResourceDefinition<TDependencies> => {
    const issues = resourceIssues(definition, 0, 'portable');
    if (issues.length > 0) throw new McpAppsValidationError(issues);
    return Object.freeze(definition);
  };
}

/**
 * Validates resource identity, tool linkage, canonical origins, and host-profile requirements.
 * A single plugin origin may be reused by any number of resources.
 */
export function validateMcpApps<TDependencies>(
  definition: McpServerDefinition<TDependencies>,
  options: { readonly profile?: McpAppsValidationProfile } = {},
): void {
  const apps = definition.apps;
  const profile = options.profile ?? 'portable';
  const resources = apps?.resources ?? [];
  const issues = resources.flatMap((resource, index) => resourceIssues(resource, index, profile));
  const names = new Map<string, number>();
  const uris = new Map<string, number>();
  for (const [index, resource] of resources.entries()) {
    const previousName = names.get(resource.name);
    if (previousName !== undefined) {
      issues.push({
        code: 'duplicate_resource_name',
        path: `apps.resources[${index}].name`,
        message: `Resource name duplicates apps.resources[${previousName}].name`,
      });
    } else names.set(resource.name, index);
    const previousUri = uris.get(resource.uri);
    if (previousUri !== undefined) {
      issues.push({
        code: 'duplicate_resource_uri',
        path: `apps.resources[${index}].uri`,
        message: `Resource URI duplicates apps.resources[${previousUri}].uri`,
      });
    } else uris.set(resource.uri, index);
  }
  for (const [index, tool] of definition.tools.entries()) {
    const typedUi = tool.ui as MetaObject | undefined;
    const path = `tools[${index}].ui`;
    const ui = effectiveUiMetadata(tool._meta, typedUi);
    issues.push(...uiContainerIssues(tool._meta, typedUi, path));
    const resourceUri = ui['resourceUri'];
    const visibility = ui['visibility'];
    if (
      visibility !== undefined &&
      (!Array.isArray(visibility) ||
        !visibility.every((entry) => entry === 'model' || entry === 'app'))
    ) {
      issues.push({
        code: 'invalid_ui_metadata',
        path: `tools[${index}].ui.visibility`,
        message: 'MCP App tool visibility must contain only model or app',
      });
    }
    if (
      resourceUri !== undefined &&
      (typeof resourceUri !== 'string' || !validUiResourceUri(resourceUri))
    ) {
      issues.push({
        code: 'invalid_tool_resource_uri',
        path: `tools[${index}].ui.resourceUri`,
        message: 'MCP App tool resource URIs must use the ui:// scheme',
      });
    } else if (resourceUri !== undefined && !uris.has(resourceUri)) {
      issues.push({
        code: 'unregistered_tool_resource',
        path: `tools[${index}].ui.resourceUri`,
        message: `Tool references unregistered MCP App resource ${resourceUri}`,
      });
    }
  }
  if (issues.length > 0) throw new McpAppsValidationError(issues);
}

interface McpUiToolDefinitionLike {
  readonly _meta?: MetaObject;
  readonly ui?: McpUiToolMetadata;
}

function standardToolMetadata(
  tool: McpUiToolDefinitionLike,
  compatibility: McpAppsCompatibilityOptions | undefined,
): MetaObject | undefined {
  const existingUi = isMetaObject(tool._meta?.['ui']) ? tool._meta['ui'] : {};
  if (!tool.ui && Object.keys(existingUi).length === 0) return tool._meta;
  const ui = { ...existingUi, ...tool.ui };
  const resourceUri = ui['resourceUri'];
  return {
    ...tool._meta,
    ui,
    ...(compatibility?.openaiLegacyAliases && typeof resourceUri === 'string'
      ? { 'openai/outputTemplate': resourceUri }
      : {}),
  };
}

function legacyOpenAiCsp(csp: MetaObject): MetaObject {
  return {
    ...(validStringArray(csp['connectDomains']) ? { connect_domains: csp['connectDomains'] } : {}),
    ...(validStringArray(csp['resourceDomains'])
      ? { resource_domains: csp['resourceDomains'] }
      : {}),
    ...(validStringArray(csp['frameDomains']) ? { frame_domains: csp['frameDomains'] } : {}),
  };
}

function resourceContentMetadata<TDependencies>(
  resource: McpAppResourceDefinition<TDependencies>,
  compatibility: McpAppsCompatibilityOptions | undefined,
): MetaObject | undefined {
  const existingUi = isMetaObject(resource._meta?.['ui']) ? resource._meta['ui'] : {};
  const hasUi = resource.ui !== undefined || Object.keys(existingUi).length > 0;
  const ui = { ...existingUi, ...resource.ui };
  const standard = hasUi ? { ui } : {};
  const existingLegacyCsp = isMetaObject(resource._meta?.['openai/widgetCSP'])
    ? resource._meta['openai/widgetCSP']
    : {};
  const domain = ui['domain'];
  const csp = ui['csp'];
  const prefersBorder = ui['prefersBorder'];
  const legacy = compatibility?.openaiLegacyAliases
    ? {
        ...(typeof domain === 'string' ? { 'openai/widgetDomain': domain } : {}),
        ...(isMetaObject(csp)
          ? {
              'openai/widgetCSP': {
                ...existingLegacyCsp,
                ...legacyOpenAiCsp(csp),
              },
            }
          : {}),
        ...(typeof prefersBorder === 'boolean'
          ? { 'openai/widgetPrefersBorder': prefersBorder }
          : {}),
      }
    : {};
  const metadata = { ...resource._meta, ...standard, ...legacy };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function mcpAppToolMetadata(
  tool: McpUiToolDefinitionLike,
  compatibility: McpAppsCompatibilityOptions | undefined,
): MetaObject | undefined {
  return standardToolMetadata(tool, compatibility);
}

/** @internal Registers portable definitions with the official SDK v2 resource API. */
export function registerMcpAppResources<TDependencies>(
  server: McpServer,
  apps: McpAppsDefinition<TDependencies>,
  context: McpRequestContext<TDependencies>,
): void {
  for (const resource of apps.resources) {
    const metadata = resourceContentMetadata(resource, apps.compatibility);
    server.registerResource(
      resource.name,
      resource.uri,
      {
        ...(resource.title ? { title: resource.title } : {}),
        ...(resource.description ? { description: resource.description } : {}),
        mimeType: MCP_APP_RESOURCE_MIME_TYPE,
        ...(metadata ? { _meta: metadata } : {}),
      },
      mcpExtensionErrorBoundary.resource(async () => {
        enforceRequiredScopes(context.principal, resource.requiredScopes ?? []);
        const html =
          typeof resource.html === 'function' ? await resource.html(context) : resource.html;
        return {
          contents: [
            {
              uri: resource.uri,
              mimeType: MCP_APP_RESOURCE_MIME_TYPE,
              text: html,
              ...(metadata ? { _meta: metadata } : {}),
            },
          ],
        };
      }),
    );
  }
}

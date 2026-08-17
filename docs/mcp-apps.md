# MCP Apps and UI resources

`mcp-kit` supports the stable MCP Apps server pattern in portable definitions: a tool advertises a
`ui://` resource through `_meta.ui.resourceUri`, and `resources/read` returns HTML with MIME type
`text/html;profile=mcp-app` plus standard `_meta.ui` resource metadata. The official
[MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
defines the portable contract. OpenAI's
[plugin UI guide](https://developers.openai.com/plugins/build/chatgpt-ui) and
[metadata reference](https://developers.openai.com/plugins/reference) add submission and optional
ChatGPT compatibility requirements.

The package owns server-side definitions and serialization plus an optional browser lifecycle. A
consuming service owns its HTML bundle, rendering and business-data interpretation, origin, DNS,
TLS, ingress, and deployment. The kit does not host component assets, reimplement the iframe
protocol, choose a customer domain, or verify a domain with a host.

## Browser runtime

Use the isolated `@koonweee/mcp-kit/apps` entrypoint inside the bundled App view. It composes the
official ext-apps 1.7.5 `App` and `PostMessageTransport`; mcp-kit does not implement JSON-RPC or the
postMessage protocol.

```ts
import { createMcpAppRuntime } from '@koonweee/mcp-kit/apps';

const runtime = createMcpAppRuntime({
  appInfo: { name: 'report-dashboard', version: '1.0.0' },
  onStateChange(state) {
    if (state.status === 'loading') renderLoading();
    if (state.status === 'ready') renderReport(state.result.structuredContent);
    if (state.status === 'error') renderError(state.error.message);
  },
});

await runtime.connect();
```

Create the runtime after the document exists. Its initial state is exactly `{ status: 'loading' }`:
there is no sample result, fixture, or service data. Complete or partial tool input returns the view
to `loading`; the official tool-result notification produces `ready`; initialization, transport,
cancellation, and teardown failures produce a safe `error` state. Consumers parse and validate
`ready.result.structuredContent` for their own business schema.

The runtime installs every handler before connecting. It applies the initial and changed host theme,
CSS variables, fonts, and safe-area insets through the official style helpers and canonical safe-area
padding pattern. It retains the official resize-observer cleanup, closes the transport on page hide
or host teardown, removes its listener and timer, restores the styles it changed, and makes `close()`
idempotent. Call `await runtime.close()` before replacing a view yourself.

`runtime.app` exposes the common official host methods such as `callServerTool`, `sendLog`,
`openLink`, and `requestTeardown`. The optional `transport` setting is an advanced structural seam;
the default always constructs the official parent-window `PostMessageTransport`. Tests in this
repository inject only explicit test transports and results through an official `AppBridge`; no test
fixture is part of the production/default path.

Migrating a hand-wired App view is mechanical: remove local App and transport construction, move
tool/context/teardown callbacks into `createMcpAppRuntime`, render from its discriminated state, and
replace ad hoc observer/listener cleanup with `runtime.close()`. Delete demo-result fallbacks rather
than passing them into the new layer.

## Define and link an app

Create a resource with `defineAppResource`, link selected tools through their typed `ui` field, and
register the resource under the server's `apps` field:

```ts
import { defineAppResource, defineServer, defineTool, validateMcpApps } from '@koonweee/mcp-kit';
import { z } from 'zod/v4';

interface Dependencies {
  reports: { summary(): Promise<{ total: number }> };
}

// This is an explicit consumer-owned configuration value. One origin may host every template in
// the same plugin; mcp-kit neither provisions nor verifies it.
const uiOrigin = 'https://widgets.example.com';

const dashboard = defineAppResource<Dependencies>()({
  name: 'report-dashboard',
  uri: 'ui://reports/dashboard-v1.html',
  title: 'Report dashboard',
  description: 'Interactive report totals and filters.',
  ui: {
    domain: uiOrigin,
    prefersBorder: true,
    csp: {
      connectDomains: ['https://api.example.com'],
      resourceDomains: ['https://static.example.com'],
    },
  },
  requiredScopes: ['reports:read'],
  html: '<!doctype html><html lang="en"><body><div id="root"></div><script type="module">/* bundled MCP Apps UI */</script></body></html>',
});

const showDashboard = defineTool<Dependencies>()({
  name: 'show-report-dashboard',
  description: 'Return report totals and optionally render the dashboard',
  inputSchema: z.object({}),
  outputSchema: z.object({ total: z.number() }),
  ui: { resourceUri: dashboard.uri },
  requiredScopes: ['reports:read'],
  risk: { kind: 'read' },
  async handler(_input, context) {
    const summary = await context.dependencies.reports.summary();
    return {
      // Headless clients still receive a useful, model-visible result.
      content: [{ type: 'text', text: `Total reports: ${summary.total}` }],
      structuredContent: summary,
    };
  },
});

export const reportsServer = defineServer<Dependencies>()({
  name: 'reports-mcp',
  version: '1.0.0',
  apps: { resources: [dashboard] },
  tools: [showDashboard],
});

// Run this in release/configuration validation for a public OpenAI plugin with UI.
validateMcpApps(reportsServer, { profile: 'openai-submission' });
```

`defineServer` always applies the portable validation profile. It rejects duplicate resources,
non-`ui://` resource URIs, broken tool links, and non-canonical UI origins. The HTML provider may
also be a request-local function that receives `McpRequestContext<TDependencies>`.

Treat each resource URI as a cache key. Publish a new URI and update every linked tool when a
breaking HTML, JavaScript, or CSS change would make a cached template incompatible.

## Resource authorization

Declare `requiredScopes` on an App resource when its HTML is not public. The kit checks every
declared scope against the request-local validated principal before returning static HTML or
invoking an HTML provider. A missing scope becomes a sanitized MCP protocol error with the public
message `Insufficient scope`; the provider and its dependencies are not called.

Omitting `requiredScopes` or setting it to `[]` preserves public-at-the-MCP-layer behavior when the
runtime has no endpoint-wide authentication gate. Resource and tool policies are independent, so
declare the intended scopes on both the App resource and every linked tool. Scope requirements are
server policy and are never inferred from client-visible `_meta`.

## Domains and OpenAI submission

The stable MCP Apps specification makes `ui.domain` optional because hosts may supply their own
sandbox origin. When present in `mcp-kit`, it must be a canonical HTTPS origin such as
`https://widgets.example.com`: no trailing slash, path, query, fragment, credentials, uppercase
host spelling, or explicit default port.

OpenAI requires a dedicated UI origin when submitting a plugin with custom UI. Call
`validateMcpApps(definition, { profile: 'openai-submission' })` before submission to catch every
resource missing `ui.domain`. "Dedicated" means the origin belongs to that plugin rather than that
every template needs a different origin. Multiple resources in one plugin may intentionally share
one origin, as may multiple tools that link to the same resource.

Domain verification for the MCP endpoint and UI-origin operations remain deployment concerns. This
package does not own DNS, TLS, ingress, the OpenAI verification challenge, or selection of a
production hostname.

## CSP and permissions

`ui.csp` supports the stable `connectDomains`, `resourceDomains`, `frameDomains`, and
`baseUriDomains` fields. Omit an allowlist when the UI does not need that capability; MCP Apps hosts
apply restrictive defaults. `ui.permissions` supports the stable camera, microphone, geolocation,
and clipboard-write requests. Hosts may deny requested permissions, so component code must still
feature-detect them.

Keep CSP allowlists exact. `connectDomains` may include the origins required for fetch, WebSocket,
or similar connections; `resourceDomains` covers scripts, styles, images, fonts, and media;
`frameDomains` opts into nested frames and can trigger stricter host review.

## Optional ChatGPT legacy aliases

Standard `_meta.ui` fields are always the authoritative API. Current ChatGPT supports them directly.
For an older ChatGPT integration that still needs the historical aliases, enable them explicitly:

```ts
const definition = defineServer<Dependencies>()({
  name: 'reports-mcp',
  version: '1.0.0',
  apps: {
    resources: [dashboard],
    compatibility: { openaiLegacyAliases: true },
  },
  tools: [showDashboard],
});
```

This adds `openai/outputTemplate`, `openai/widgetDomain`, `openai/widgetCSP`, and
`openai/widgetPrefersBorder` alongside their standard equivalents. It does not replace or weaken
the standard metadata, and it does not enable ChatGPT-only iframe APIs. Leave the option off for a
standards-only server.

ChatGPT's `openExternal` API additionally requires allowed targets in the legacy
`openai/widgetCSP.redirect_domains` field. When that API is unavoidable, supply the field through
the resource's `_meta['openai/widgetCSP']` object and enable `openaiLegacyAliases`. The kit preserves
`redirect_domains` while deriving the overlapping legacy CSP allowlists from authoritative
standard `ui.csp` values.

## Agent guidance

- Owning files: `src/core/apps.ts` owns typed metadata, serialization, compatibility aliases, and
  validation; `src/core/definition.ts` owns first-class server and tool integration; `src/apps/`
  owns the isolated browser lifecycle.
- Preserve the stable `ui://`, `text/html;profile=mcp-app`, resource-content `_meta.ui`, and tool
  `_meta.ui.resourceUri` wire contract. Keep host-specific aliases opt-in.
- Keep tool `content` and, when declared, `structuredContent` useful without rendered UI.
- Keep App resource `requiredScopes` aligned with the service's authorization policy; enforcement
  must happen before HTML generation or dependency access.
- Verify changes with `pnpm vitest run test/core/apps.test.ts test/core/definition.test.ts`, then run
  `pnpm vitest run test/apps/runtime.test.ts`, `pnpm test:exports`, `pnpm test:consumer`, and the full
  `pnpm verify` gate.
- Read [Architecture](architecture.md) for the portability boundary and
  [Defining a server](server-definition.md) for shared tool policy.

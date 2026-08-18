# mcp-kit

`@koonweee/mcp-kit` is a small TypeScript toolkit for defining independently deployed, stateless MCP
servers in a personal stack. It provides portable tool and MCP Apps definitions, a Node Streamable
HTTP adapter, Auth0 resource-server support, safe policy and logging defaults, and test helpers.
Service tools, UI bundles, backend clients, credentials, domains, and deployment stay in the
consuming service repository.

The package supports Node.js 24 or newer from both ESM and CommonJS applications. Cloudflare is a
documented adapter seam, not a supported runtime.

## Install

Install the public package from npm:

```bash
pnpm add @koonweee/mcp-kit zod
```

Define tools with `defineTool` and `defineServer`, then pass the definition to `serveNode`. See [Defining a server](docs/server-definition.md) for the complete minimal example and [Auth0](docs/auth0.md) for protecting a public endpoint.

Tool handlers receive typed `context.client.inputRequired` support booleans for safe ordinary
fallbacks when a modern or legacy client cannot fulfil an elicitation.

Low-level resources and prompts registered through `extend` use `mcpExtensionErrorBoundary` so
unexpected service failures cannot cross the protocol boundary.

MCP Apps resources and typed tool links use the standard `ui://`,
`text/html;profile=mcp-app`, and `_meta.ui` wire shapes. See
[MCP Apps and UI resources](docs/mcp-apps.md), including the explicit OpenAI submission validation
profile, server-enforced resource `requiredScopes`, the optional browser lifecycle, and opt-in legacy
ChatGPT aliases. The browser runtime also exposes the official `updateModelContext`, `sendMessage`,
and host-capability discovery methods through its typed `runtime.app` surface, so interactive
selections can inform a future model turn or deliberately start one when the host advertises
`ui/message` support.

```ts
import { defineServer, defineTool } from '@koonweee/mcp-kit';
import { serveNode } from '@koonweee/mcp-kit/node';
import { z } from 'zod/v4';

const ping = defineTool<Record<string, never>>()({
  name: 'ping',
  description: 'Return a health message',
  inputSchema: z.object({}),
  requiredScopes: [],
  risk: { kind: 'read' },
  handler: () => ({ content: [{ type: 'text', text: 'pong' }] }),
});

const definition = defineServer<Record<string, never>>()({
  name: 'example',
  version: '1.0.0',
  tools: [ping],
});

await serveNode(definition, { dependencies: () => ({}) });
```

CommonJS consumers use the same public paths and APIs:

```js
const { defineServer, defineTool } = require('@koonweee/mcp-kit');
const { serveNode } = require('@koonweee/mcp-kit/node');
```

## Guides

- [Architecture and boundaries](docs/architecture.md)
- [Defining a server](docs/server-definition.md)
- [MCP Apps and UI resources](docs/mcp-apps.md)
- [Auth0 resource-server setup](docs/auth0.md)
- [Testing and package verification](docs/testing.md)
- [Runtime adapters](docs/adapters.md)
- [Releasing and adopting](docs/releasing.md)

The only public package paths are `@koonweee/mcp-kit`, `@koonweee/mcp-kit/node`,
`@koonweee/mcp-kit/auth0`, `@koonweee/mcp-kit/test`, and the browser-only
`@koonweee/mcp-kit/apps`. Every path supports both `import` and `require`; do not import files under
`dist`.

## Agent guidance

- Owning files: `src/index.ts`, the public subpath indexes, and `package.json` own the contract summarized here.
- Preserve the repository boundaries in [Architecture](docs/architecture.md); never move service tools, clients, secrets, or deployment into this package.
- Verify README or public-contract changes with `pnpm docs:check`, `pnpm test:exports`, and `pnpm test:consumer`.
- Read [Architecture](docs/architecture.md) next for dependency direction and deliberate exclusions.

# Defining a server

A service declares explicit tools in portable code and injects backend dependencies when its runtime handles a request. Definitions never read environment variables or import runtime adapters.

## Minimal definition

```ts
import { McpPublicError, defineServer, defineTool } from '@koonweee/mcp-kit';
import { z } from 'zod/v4';

interface Dependencies {
  notes: {
    find(id: string): Promise<string | undefined>;
  };
}

const getNote = defineTool<Dependencies>()({
  name: 'get_note',
  description: 'Read one note by ID',
  inputSchema: z.object({ id: z.string().min(1) }),
  outputSchema: z.object({ id: z.string(), note: z.string() }),
  _meta: { 'com.example/displayMode': 'compact' },
  requiredScopes: ['notes:read'],
  risk: { kind: 'read' },
  async handler({ id }, context) {
    const note = await context.dependencies.notes.find(id);
    if (!note) throw new McpPublicError('not_found', 'Note not found');
    return {
      content: [{ type: 'text', text: note }],
      structuredContent: { id, note },
    };
  },
});

export const notesServer = defineServer<Dependencies>()({
  name: 'notes-mcp',
  version: '1.0.0',
  instructions: 'Use note tools only for the requested note.',
  tools: [getNote],
});
```

The curried helpers preserve schema output inference and the shared dependency type. Each tool must declare a name, description, Zod input schema, required scopes, server-side risk, and handler. `content` is required in every result.

`outputSchema` is optional and accepts the same Standard Schema plus JSON Schema interface as the official SDK; Zod v4 schemas implement it directly. When present, a successful handler result must include `structuredContent` matching the schema's inferred output type. The official SDK advertises the converted JSON Schema in `tools/list` and validates successful structured output at runtime. Without `outputSchema`, `structuredContent` remains optional and keeps the SDK's `unknown` type. Error results remain exempt from output validation, matching the SDK.

Tool-level `_meta` is optional extension metadata forwarded to `McpServer.registerTool()` and
advertised in `tools/list`. Use the typed `ui` field and first-class `apps.resources` definitions for
MCP Apps rather than hand-authoring standard UI metadata; see
[MCP Apps and UI resources](mcp-apps.md). `_meta` remains available for other client-specific hints,
but it is not an authorization or risk-policy input. Treat it as client-visible, untrusted extension
data: never put credentials, tokens, personal data, or other secrets in `_meta`.

## Modern multi-round input

Handlers receive the official SDK `ServerContext` as their third argument. They may return the SDK's `InputRequiredResult` alongside a normal tool result, including when the tool declares `outputSchema`. Existing handlers that use only the input or the kit request context remain compatible.

Use the official SDK helpers directly; mcp-kit does not wrap or re-export them:

```ts
import { acceptedContent, inputRequired } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

const confirmationSchema = z.object({ confirmed: z.boolean() });

const deploy = defineTool<Dependencies>()({
  name: 'deploy',
  description: 'Deploy one environment',
  inputSchema: z.object({ environment: z.string() }),
  outputSchema: z.object({ deployed: z.boolean() }),
  requiredScopes: ['deploy:write'],
  risk: { kind: 'mutating' },
  handler({ environment }, context, sdkContext) {
    const confirmation = acceptedContent(
      sdkContext.mcpReq.inputResponses,
      'confirmation',
      confirmationSchema,
    );
    if (!confirmation?.confirmed) {
      if (!context.client.inputRequired.formElicitation) {
        return {
          content: [{ type: 'text', text: `Preview ${environment}; confirm in a capable client.` }],
          structuredContent: { deployed: false },
        };
      }
      return inputRequired({
        inputRequests: {
          confirmation: inputRequired.elicit({
            message: `Deploy ${environment}?`,
            requestedSchema: confirmationSchema,
          }),
        },
      });
    }
    return {
      content: [{ type: 'text', text: `Deployed ${environment}` }],
      structuredContent: { deployed: true },
    };
  },
});
```

Every input response came through the client and is untrusted. Always use `acceptedContent(responses, key, schema)` (or perform equivalent explicit validation) before making authorization, resource-access, or business decisions. Likewise, integrity-protect and verify `requestState` if it influences those decisions. Do not use the deprecated push-style `getClientCapabilities()`/`elicitInput()` flow for modern multi-round interaction.

The kit-owned second handler argument exposes a narrow, typed support view at
`context.client`. Check `context.client.inputRequired.formElicitation` before returning a form
elicitation and provide a useful ordinary result when it is false. URL-mode tools similarly check
`urlElicitation`; `context.client.protocolEra` is `modern`, `legacy`, or `unknown` when diagnostics
need the transport era. Modern support is derived from the validated per-request SDK envelope.
Legacy support uses the initialized SDK capability view and reflects the default legacy shim;
stateless legacy requests without initialization capability state conservatively report false. The
third handler argument remains the unmodified official `ServerContext`.

## Policy, errors, and logging

`requiredScopes` is authoritative. When a tool declares scopes, anonymous callers and principals missing any declared scope are denied before service code executes. A tool with an empty scope list may run anonymously when the host has no endpoint-wide authentication gate. Risk is independently authoritative server metadata:

- `read` defaults to read-only and idempotent;
- `mutating` defaults to non-read-only and non-idempotent; and
- `destructive` additionally sets the destructive hint.

`openWorld` defaults to false. MCP annotations derived from these values help clients present a tool, but never grant access or replace backend authorization.

Throw `McpPublicError` only when a stable message is safe for the caller. Unknown failures become `The tool could not be completed`; their cause is available to the logger seam but is never returned. Logger implementations receive allowlisted operational records containing only the event, opaque request ID, tool name, and optional duration, outcome, or safe error code. Principal subjects, client IDs, scopes, other authentication claims, handler input/output, tokens, secrets, and causes are never record fields. Generate request IDs independently of identity data and use them as the only per-request correlation key. `safeConsoleLogger` applies this allowlist again at runtime and ignores internal causes; use it or `silentLogger` unless a service supplies an equally restrictive logger.

## Request-local dependencies

The Node adapter calls `dependencies(context)` for each request. Load process configuration in the consumer entrypoint, then construct a fresh dependency view there. Do not place service credentials in a definition, principal claims, result, log record, or request ID.

```ts
import { serveNode } from '@koonweee/mcp-kit/node';
import { notesServer } from './definition.js';
import { createNotesClient } from './notes-client.js';

const apiUrl = new URL(process.env.NOTES_API_URL!);
const apiToken = process.env.NOTES_API_TOKEN!;

await serveNode(notesServer, {
  dependencies: () => ({ notes: createNotesClient(apiUrl, apiToken) }),
});
```

`extend(server, context)` is the deliberate low-level seam for official SDK resources or prompts. Keep extensions portable and request-local; it is not permission to depend on Node or service-global mutable state.

Every callback registered through that seam must use `mcpExtensionErrorBoundary`. Direct official
SDK registration otherwise has no kit-owned public-error boundary:

```ts
import { mcpExtensionErrorBoundary } from '@koonweee/mcp-kit';
import { ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

const reportPromptSchema = z.object({ reportId: z.string() });

export const reportsServer = defineServer<Dependencies>()({
  name: 'reports-mcp',
  version: '1.0.0',
  tools: [],
  extend(server, context) {
    server.registerResource(
      'report',
      new ResourceTemplate('report://{reportId}', { list: undefined }),
      { mimeType: 'application/json' },
      mcpExtensionErrorBoundary.resourceTemplate(async (uri, { reportId }) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              (await context.dependencies.reports.find(String(reportId))) ?? null,
            ),
          },
        ],
      })),
    );
    server.registerPrompt(
      'review-report',
      { argsSchema: reportPromptSchema },
      mcpExtensionErrorBoundary.prompt(reportPromptSchema, ({ reportId }) => ({
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: `Review report ${reportId}` },
          },
        ],
      })),
    );
  },
});
```

Use `.resource(...)`, `.resourceTemplate(...)`, and `.prompt(schema, ...)` for contextually typed
read and prompt callbacks. Resource templates can also protect `list` and `complete` callbacks with
`.listResources(...)` and `.completeResourceTemplate(...)`. `.wrap(...)` provides the same boundary
for another already-typed official SDK extension callback.

Valid results and `InputRequiredResult` values pass through unchanged. Official SDK
`ProtocolError` instances also pass through so resource-not-found, invalid-parameter, and other
protocol semantics remain intact. Throw `McpPublicError` only for a message deliberately approved
for the caller. Any other synchronous exception or asynchronous rejection becomes JSON-RPC
internal error `-32603` with `The MCP request could not be completed`; no cause or error data is
attached and the boundary does not log callback arguments, results, or failures.

## Agent guidance

- Owning files: `src/core/definition.ts`, `src/core/context.ts`, `src/core/extensions.ts`, `src/core/policy.ts`, `src/core/errors.ts`, and `src/core/logging.ts` own this contract.
- Keep Zod validation, required-scope enforcement, risk policy, sanitized errors, and safe logging ahead of service behavior.
- Pass tool schemas and extension metadata through the official SDK instead of converting, validating, or interpreting them in core; `_meta` must never contain secrets or change authorization behavior.
- Pass the official `ServerContext` and `InputRequiredResult` through unchanged. Do not add a parallel elicitation framework; validate untrusted responses with `acceptedContent(..., schema)`.
- Verify definition changes with `pnpm vitest run test/core/definition.test.ts test/core/boundary.test.ts` and typecheck with `pnpm typecheck`.
- Read [Auth0](auth0.md) next when the definition will be served publicly, or [Testing](testing.md) to test it without HTTP.

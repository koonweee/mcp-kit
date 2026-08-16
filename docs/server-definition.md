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

Tool-level `_meta` is optional extension metadata forwarded to `McpServer.registerTool()` and advertised in `tools/list`. It can carry client-specific hints, including MCP Apps metadata, but it is not an authorization or risk-policy input. Treat it as client-visible, untrusted extension data: never put credentials, tokens, personal data, or other secrets in `_meta`.

## Policy, errors, and logging

`requiredScopes` is authoritative. When a tool declares scopes, anonymous callers and principals missing any declared scope are denied before service code executes. A tool with an empty scope list may run anonymously when the host has no endpoint-wide authentication gate. Risk is independently authoritative server metadata:

- `read` defaults to read-only and idempotent;
- `mutating` defaults to non-read-only and non-idempotent; and
- `destructive` additionally sets the destructive hint.

`openWorld` defaults to false. MCP annotations derived from these values help clients present a tool, but never grant access or replace backend authorization.

Throw `McpPublicError` only when a stable message is safe for the caller. Unknown failures become `The tool could not be completed`; their cause is available to the logger seam but is never returned. Logger implementations receive allowlisted operational records only and must not serialize handler input, output, tokens, secrets, or causes. Use `safeConsoleLogger` or `silentLogger` unless a service supplies an equally restrictive logger.

## Request-local dependencies

The Node adapter calls `dependencies(context)` for each request. Load process configuration in the consumer entrypoint, then construct a fresh dependency view there. Do not place service credentials in a definition, principal claims, result, or log record.

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

## Agent guidance

- Owning files: `src/core/definition.ts`, `src/core/context.ts`, `src/core/policy.ts`, `src/core/errors.ts`, and `src/core/logging.ts` own this contract.
- Keep Zod validation, required-scope enforcement, risk policy, sanitized errors, and safe logging ahead of service behavior.
- Pass tool schemas and extension metadata through the official SDK instead of converting, validating, or interpreting them in core; `_meta` must never contain secrets or change authorization behavior.
- Verify definition changes with `pnpm vitest run test/core/definition.test.ts test/core/boundary.test.ts` and typecheck with `pnpm typecheck`.
- Read [Auth0](auth0.md) next when the definition will be served publicly, or [Testing](testing.md) to test it without HTTP.

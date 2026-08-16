# Defining a server

A service declares explicit tools in portable code and injects backend dependencies when its runtime handles a request. Definitions never read environment variables or import runtime adapters.

## Minimal definition

```ts
import { McpPublicError, defineServer, defineTool } from '@jtkw/mcp-kit';
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

The curried helpers preserve both Zod output inference and the shared dependency type. Each tool must declare a name, description, input schema, required scopes, server-side risk, and handler. `content` is required in every result; `structuredContent` is optional.

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
import { serveNode } from '@jtkw/mcp-kit/node';
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
- Verify definition changes with `pnpm vitest run test/core/definition.test.ts test/core/boundary.test.ts` and typecheck with `pnpm typecheck`.
- Read [Auth0](auth0.md) next when the definition will be served publicly, or [Testing](testing.md) to test it without HTTP.

/**
 * Privacy-safe operational fields emitted by the kit.
 *
 * `requestId` is the only correlation field. Consumers must keep it opaque and must not derive it
 * from a principal, token, or claim. Tool arguments, results, identities, and authentication claims
 * are never included.
 */
export interface McpLogRecord {
  readonly event: 'tool.started' | 'tool.completed' | 'tool.denied' | 'tool.failed';
  readonly requestId: string;
  readonly toolName: string;
  readonly durationMs?: number;
  readonly outcome?: 'success' | 'denied' | 'error';
  readonly errorCode?: string;
}

/** Structured logging seam. Implementations must not serialize tool data, tokens, or secrets. */
export interface McpLogger {
  log(record: McpLogRecord): void;
  error(record: McpLogRecord, cause: unknown): void;
}

/** A no-op logger useful for tests and callers that already instrument execution elsewhere. */
export const silentLogger: McpLogger = Object.freeze<McpLogger>({
  log() {},
  error() {},
});

function allowlistedRecord(record: McpLogRecord): McpLogRecord {
  return {
    event: record.event,
    requestId: record.requestId,
    toolName: record.toolName,
    ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
    ...(record.outcome !== undefined ? { outcome: record.outcome } : {}),
    ...(record.errorCode !== undefined ? { errorCode: record.errorCode } : {}),
  };
}

/**
 * Safe console logger that ignores internal causes and applies a runtime field allowlist before
 * serialization. This remains safe when untyped JavaScript passes an object with extra fields.
 */
export const safeConsoleLogger: McpLogger = Object.freeze<McpLogger>({
  log(record: McpLogRecord) {
    console.info(JSON.stringify(allowlistedRecord(record)));
  },
  error(record: McpLogRecord) {
    console.error(JSON.stringify(allowlistedRecord(record)));
  },
});

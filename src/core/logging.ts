/** Safe operational fields emitted by the kit. Tool arguments and results are never included. */
export interface McpLogRecord {
  readonly event: 'tool.started' | 'tool.completed' | 'tool.denied' | 'tool.failed';
  readonly requestId: string;
  readonly subject?: string;
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

/** Safe console logger that intentionally ignores internal causes and logs only allowlisted fields. */
export const safeConsoleLogger: McpLogger = Object.freeze<McpLogger>({
  log(record: McpLogRecord) {
    console.info(JSON.stringify(record));
  },
  error(record: McpLogRecord) {
    console.error(JSON.stringify(record));
  },
});

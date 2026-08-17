import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeConsoleLogger, type McpLogRecord } from '../../src/index.js';

describe('safe logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('projects an explicit runtime allowlist before console serialization', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const untypedRecord = {
      event: 'tool.failed',
      requestId: 'opaque-request-id',
      toolName: 'example',
      durationMs: 4,
      outcome: 'error',
      errorCode: 'backend_failed',
      subject: 'secret-auth0-subject',
      token: 'secret-access-token',
      claims: { email: 'secret@example.test' },
    } as unknown as McpLogRecord;

    safeConsoleLogger.log(untypedRecord);
    safeConsoleLogger.error(untypedRecord, new Error('secret internal cause'));

    const expected = JSON.stringify({
      event: 'tool.failed',
      requestId: 'opaque-request-id',
      toolName: 'example',
      durationMs: 4,
      outcome: 'error',
      errorCode: 'backend_failed',
    });
    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(expected);
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expected);
    expect(expected).not.toContain('secret');
  });
});

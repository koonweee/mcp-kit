import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Implementation } from '@modelcontextprotocol/sdk/types.js';
import type { McpAppToolResult } from '../../src/apps/index.js';

export interface McpUiHostContext {
  [key: string]: unknown;
  theme?: 'light' | 'dark';
  styles?: {
    variables?: Record<`--${string}`, string | undefined>;
    css?: { fonts?: string };
  };
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
}

export class AppBridge {
  constructor(
    client: null,
    hostInfo: Implementation,
    capabilities: Record<string, object>,
    options?: { hostContext?: McpUiHostContext },
  );
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
  sendToolInput(params: { arguments?: Record<string, unknown> }): Promise<void>;
  sendToolResult(params: McpAppToolResult): Promise<void>;
  teardownResource(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

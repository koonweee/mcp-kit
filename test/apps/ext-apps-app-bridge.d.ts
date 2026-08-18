import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { EmptyResult, Implementation } from '@modelcontextprotocol/sdk/types.js';
import type {
  McpAppHostCapabilities,
  McpAppMessage,
  McpAppMessageResult,
  McpAppModelContext,
  McpAppToolResult,
} from '../../src/apps/index.js';

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
    capabilities: McpAppHostCapabilities,
    options?: { hostContext?: McpUiHostContext },
  );
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
  sendToolInput(params: { arguments?: Record<string, unknown> }): Promise<void>;
  sendToolResult(params: McpAppToolResult): Promise<void>;
  teardownResource(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  get onupdatemodelcontext(): ((params: McpAppModelContext) => Promise<EmptyResult>) | undefined;
  set onupdatemodelcontext(
    callback: ((params: McpAppModelContext) => Promise<EmptyResult>) | undefined,
  );
  get onmessage(): ((params: McpAppMessage) => Promise<McpAppMessageResult>) | undefined;
  set onmessage(callback: ((params: McpAppMessage) => Promise<McpAppMessageResult>) | undefined);
}

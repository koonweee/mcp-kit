import type {
  CallToolResult,
  Implementation,
  RequestOptions,
  Transport,
} from '@modelcontextprotocol/client';

export interface McpUiAppCapabilities {
  experimental?: Record<string, object>;
  tools?: { listChanged?: boolean };
  availableDisplayModes?: Array<'inline' | 'fullscreen' | 'pip'>;
}

export interface McpUiHostContext {
  [key: string]: unknown;
  theme?: 'light' | 'dark';
  styles?: {
    variables?: Record<`--${string}`, string | undefined>;
    css?: { fonts?: string };
  };
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
}

export class App {
  constructor(
    appInfo: Implementation,
    capabilities?: McpUiAppCapabilities,
    options?: { autoResize?: boolean; strict?: boolean; allowUnsafeEval?: boolean },
  );
  ontoolinputpartial?: (params: { arguments?: Record<string, unknown> }) => void;
  ontoolinput?: (params: { arguments?: Record<string, unknown> }) => void;
  ontoolresult?: (params: CallToolResult) => void;
  ontoolcancelled?: (params: { reason?: string }) => void;
  onhostcontextchanged?: (params: McpUiHostContext) => void;
  onteardown?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  connect(transport?: Transport, options?: RequestOptions): Promise<void>;
  close(): Promise<void>;
  getHostContext(): McpUiHostContext | undefined;
  setupSizeChangedNotifications(): () => void;
  callServerTool(
    params: { name: string; arguments?: Record<string, unknown> },
    options?: RequestOptions,
  ): Promise<CallToolResult>;
  sendLog(params: { level: string; data?: unknown }): Promise<void>;
  openLink(params: { url: string }, options?: RequestOptions): Promise<{ isError?: boolean }>;
  requestTeardown(params?: Record<string, unknown>): Promise<void>;
}

export class PostMessageTransport implements Transport {
  constructor(eventTarget?: Window, eventSource?: MessageEventSource);
  start(): Promise<void>;
  send(message: Parameters<Transport['send']>[0]): Promise<void>;
  close(): Promise<void>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport['onmessage'];
}

export function applyDocumentTheme(theme: 'light' | 'dark'): void;
export function applyHostStyleVariables(
  styles: Record<`--${string}`, string | undefined>,
  root?: HTMLElement,
): void;
export function applyHostFonts(fontCss: string): void;

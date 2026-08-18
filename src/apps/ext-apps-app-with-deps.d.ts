import type {
  CallToolResult,
  ContentBlock,
  EmptyResult,
  Implementation,
  RequestOptions,
  Transport,
} from '@modelcontextprotocol/client';

export interface McpUiAppCapabilities {
  experimental?: Record<string, object>;
  tools?: { listChanged?: boolean };
  availableDisplayModes?: Array<'inline' | 'fullscreen' | 'pip'>;
}

export interface McpUiSupportedContentBlockModalities {
  text?: Record<string, never>;
  image?: Record<string, never>;
  audio?: Record<string, never>;
  resource?: Record<string, never>;
  resourceLink?: Record<string, never>;
  structuredContent?: Record<string, never>;
}

export interface McpUiResourceCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

export interface McpUiResourcePermissions {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
}

export interface McpUiHostCapabilities {
  experimental?: Record<string, object>;
  openLinks?: Record<string, never>;
  downloadFile?: Record<string, never>;
  serverTools?: { listChanged?: boolean };
  serverResources?: { listChanged?: boolean };
  logging?: Record<string, never>;
  sandbox?: {
    permissions?: McpUiResourcePermissions;
    csp?: McpUiResourceCsp;
  };
  updateModelContext?: McpUiSupportedContentBlockModalities;
  message?: McpUiSupportedContentBlockModalities;
  sampling?: { tools?: Record<string, never> };
}

export interface McpUiMessageRequest {
  method: 'ui/message';
  params: {
    role: 'user';
    content: ContentBlock[];
  };
}

export interface McpUiMessageResult {
  isError?: boolean;
  [key: string]: unknown;
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
  getHostCapabilities(): McpUiHostCapabilities | undefined;
  setupSizeChangedNotifications(): () => void;
  callServerTool(
    params: { name: string; arguments?: Record<string, unknown> },
    options?: RequestOptions,
  ): Promise<CallToolResult>;
  sendLog(params: { level: string; data?: unknown }): Promise<void>;
  updateModelContext(
    params: { content?: ContentBlock[]; structuredContent?: Record<string, unknown> },
    options?: RequestOptions,
  ): Promise<EmptyResult>;
  sendMessage(
    params: McpUiMessageRequest['params'],
    options?: RequestOptions,
  ): Promise<McpUiMessageResult>;
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

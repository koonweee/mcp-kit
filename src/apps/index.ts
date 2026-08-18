import {
  App,
  PostMessageTransport,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps/app-with-deps';
import type {
  CallToolResult,
  ContentBlock,
  EmptyResult,
  Implementation,
  RequestOptions,
  Transport,
} from '@modelcontextprotocol/client';

export type McpAppInfo = Implementation;
export type McpAppTransport = Transport;
export interface McpAppToolInput {
  readonly arguments?: Record<string, unknown>;
}
export type McpAppToolResult = CallToolResult;

/** Official `ui/message` request parameters accepted by the host. */
export interface McpAppMessage {
  readonly role: 'user';
  readonly content: ContentBlock[];
}

/** Official host result for a `ui/message` request. */
export interface McpAppMessageResult {
  readonly isError?: boolean;
  readonly [key: string]: unknown;
}

/** Content block modalities advertised for host message and model-context support. */
export interface McpAppSupportedContentBlockModalities {
  readonly text?: Record<string, never>;
  readonly image?: Record<string, never>;
  readonly audio?: Record<string, never>;
  readonly resource?: Record<string, never>;
  readonly resourceLink?: Record<string, never>;
  readonly structuredContent?: Record<string, never>;
}

/** Official host capabilities discovered during App initialization. */
export interface McpAppHostCapabilities {
  readonly experimental?: Record<string, object>;
  readonly openLinks?: Record<string, never>;
  readonly downloadFile?: Record<string, never>;
  readonly serverTools?: { readonly listChanged?: boolean };
  readonly serverResources?: { readonly listChanged?: boolean };
  readonly logging?: Record<string, never>;
  readonly sandbox?: {
    readonly permissions?: {
      readonly camera?: Record<string, never>;
      readonly microphone?: Record<string, never>;
      readonly geolocation?: Record<string, never>;
      readonly clipboardWrite?: Record<string, never>;
    };
    readonly csp?: {
      readonly connectDomains?: readonly string[];
      readonly resourceDomains?: readonly string[];
      readonly frameDomains?: readonly string[];
      readonly baseUriDomains?: readonly string[];
    };
  };
  readonly updateModelContext?: McpAppSupportedContentBlockModalities;
  readonly message?: McpAppSupportedContentBlockModalities;
  readonly sampling?: { readonly tools?: Readonly<Record<string, never>> };
}

/** Context contributed by an App for the host to include in a future model turn. */
export interface McpAppModelContext {
  readonly content?: ContentBlock[];
  readonly structuredContent?: Record<string, unknown>;
}

export interface McpAppCapabilities {
  readonly experimental?: Record<string, object>;
  readonly tools?: { readonly listChanged?: boolean };
  readonly availableDisplayModes?: ('inline' | 'fullscreen' | 'pip')[];
}

export interface McpAppHostContext {
  readonly [key: string]: unknown;
  readonly theme?: 'light' | 'dark';
  readonly styles?: {
    readonly variables?: Readonly<Record<`--${string}`, string | undefined>>;
    readonly css?: { readonly fonts?: string };
  };
  readonly safeAreaInsets?: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
}

/** Stable subset of official App host methods exposed by the runtime. */
export interface McpAppClient {
  /** Host capabilities are available after `connect()` completes. */
  getHostCapabilities(): McpAppHostCapabilities | undefined;
  callServerTool(
    params: { readonly name: string; readonly arguments?: Record<string, unknown> },
    options?: RequestOptions,
  ): Promise<McpAppToolResult>;
  sendLog(params: { readonly level: string; readonly data?: unknown }): Promise<void>;
  openLink(
    params: { readonly url: string },
    options?: RequestOptions,
  ): Promise<{ readonly isError?: boolean }>;
  /** Typed passthrough to the official ext-apps App.updateModelContext request. */
  updateModelContext(params: McpAppModelContext, options?: RequestOptions): Promise<EmptyResult>;
  /** Typed passthrough to the official ext-apps App.sendMessage `ui/message` request. */
  sendMessage(params: McpAppMessage, options?: RequestOptions): Promise<McpAppMessageResult>;
  requestTeardown(params?: Record<string, unknown>): Promise<void>;
}

export type McpAppRuntimeErrorKind = 'initialization' | 'transport' | 'cancelled' | 'teardown';

export interface McpAppRuntimeError {
  readonly kind: McpAppRuntimeErrorKind;
  readonly message: string;
}

export type McpAppRuntimeState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: McpAppToolResult }
  | { readonly status: 'error'; readonly error: McpAppRuntimeError };

export interface McpAppRuntimeOptions {
  readonly appInfo: McpAppInfo;
  readonly capabilities?: McpAppCapabilities;
  /** Advanced transport seam. Omit in production to use the official parent-window transport. */
  readonly transport?: McpAppTransport;
  /** Element receiving official host style variables. Defaults to the document root. */
  readonly styleRoot?: HTMLElement;
  /** Element receiving host safe-area padding. Defaults to `styleRoot`. */
  readonly safeAreaElement?: HTMLElement;
  /** Uses the official ext-apps resize observer while retaining its cleanup handle. */
  readonly autoResize?: boolean;
  readonly onStateChange?: (state: McpAppRuntimeState) => void;
  readonly onToolInput?: (input: McpAppToolInput) => void;
  readonly onToolResult?: (result: McpAppToolResult) => void;
  readonly onHostContextChange?: (context: McpAppHostContext) => void;
  readonly onTeardown?: () => void | Promise<void>;
}

export interface McpAppRuntime {
  readonly app: McpAppClient;
  getState(): McpAppRuntimeState;
  subscribe(listener: (state: McpAppRuntimeState) => void): () => void;
  connect(): Promise<void>;
  close(): Promise<void>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'MCP App runtime failure';

/**
 * Creates a browser-only MCP Apps runtime around the official App and PostMessageTransport.
 * The initial state deliberately contains no fixture or business data.
 */
export function createMcpAppRuntime(options: McpAppRuntimeOptions): McpAppRuntime {
  const app = new App(options.appInfo, options.capabilities ?? {}, {
    autoResize: false,
    strict: true,
  });
  const styleRoot = options.styleRoot ?? document.documentElement;
  const safeAreaElement = options.safeAreaElement ?? styleRoot;
  const subscribers = new Set<(state: McpAppRuntimeState) => void>();
  let state: McpAppRuntimeState = { status: 'loading' };
  let connected = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let resizeCleanup: (() => void) | undefined;
  let teardownTimer: ReturnType<typeof setTimeout> | undefined;
  let teardownRan = false;
  let hostTeardownRequested = false;
  let hostFontElementCreated = false;

  const initialTheme = document.documentElement.getAttribute('data-theme');
  const initialColorScheme = document.documentElement.style.colorScheme;
  const initialSafeArea = {
    top: safeAreaElement.style.paddingTop,
    right: safeAreaElement.style.paddingRight,
    bottom: safeAreaElement.style.paddingBottom,
    left: safeAreaElement.style.paddingLeft,
  };
  const initialVariables = new Map<string, string>();

  const notify = () => {
    options.onStateChange?.(state);
    for (const subscriber of subscribers) subscriber(state);
  };

  const setState = (next: McpAppRuntimeState) => {
    if (state.status === 'loading' && next.status === 'loading') return;
    state = next;
    notify();
  };

  const setError = (kind: McpAppRuntimeErrorKind, error: unknown) => {
    setState({ status: 'error', error: { kind, message: errorMessage(error) } });
  };

  const applyHostContext = (context: McpAppHostContext) => {
    if (context.theme) applyDocumentTheme(context.theme);
    if (context.styles?.variables) {
      for (const key of Object.keys(context.styles.variables)) {
        if (!initialVariables.has(key))
          initialVariables.set(key, styleRoot.style.getPropertyValue(key));
      }
      applyHostStyleVariables(context.styles.variables, styleRoot);
    }
    if (context.styles?.css?.fonts) {
      const hadHostFonts = document.getElementById('__mcp-host-fonts') !== null;
      applyHostFonts(context.styles.css.fonts);
      hostFontElementCreated ||=
        !hadHostFonts && document.getElementById('__mcp-host-fonts') !== null;
    }
    if (context.safeAreaInsets) {
      safeAreaElement.style.paddingTop = `${context.safeAreaInsets.top}px`;
      safeAreaElement.style.paddingRight = `${context.safeAreaInsets.right}px`;
      safeAreaElement.style.paddingBottom = `${context.safeAreaInsets.bottom}px`;
      safeAreaElement.style.paddingLeft = `${context.safeAreaInsets.left}px`;
    }
    options.onHostContextChange?.(context);
  };

  const restoreHostContext = () => {
    const root = document.documentElement;
    if (initialTheme === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', initialTheme);
    root.style.colorScheme = initialColorScheme;
    for (const [key, value] of initialVariables) {
      if (value) styleRoot.style.setProperty(key, value);
      else styleRoot.style.removeProperty(key);
    }
    safeAreaElement.style.paddingTop = initialSafeArea.top;
    safeAreaElement.style.paddingRight = initialSafeArea.right;
    safeAreaElement.style.paddingBottom = initialSafeArea.bottom;
    safeAreaElement.style.paddingLeft = initialSafeArea.left;
    if (hostFontElementCreated) document.getElementById('__mcp-host-fonts')?.remove();
  };

  const runTeardown = async () => {
    if (teardownRan) return;
    teardownRan = true;
    resizeCleanup?.();
    resizeCleanup = undefined;
    window.removeEventListener('pagehide', handlePageHide);
    subscribers.clear();
    restoreHostContext();
    try {
      await options.onTeardown?.();
    } catch (error) {
      setError('teardown', error);
    }
  };

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closed = true;
      if (teardownTimer !== undefined) {
        clearTimeout(teardownTimer);
        teardownTimer = undefined;
      }
      try {
        await runTeardown();
        await app.close();
      } catch (error) {
        setError('teardown', error);
      } finally {
        connected = false;
      }
    })();
    return closePromise;
  };

  function handlePageHide() {
    void close();
  }

  // Every official handler is installed before connect() can be called.
  app.ontoolinputpartial = () => {
    setState({ status: 'loading' });
  };
  app.ontoolinput = (input) => {
    setState({ status: 'loading' });
    options.onToolInput?.(input);
  };
  app.ontoolresult = (result) => {
    setState({ status: 'ready', result });
    options.onToolResult?.(result);
  };
  app.ontoolcancelled = ({ reason }) => {
    setError('cancelled', new Error(reason));
  };
  app.onhostcontextchanged = () => {
    const context = app.getHostContext();
    if (context) applyHostContext(context);
  };
  app.onteardown = async () => {
    hostTeardownRequested = true;
    await runTeardown();
    teardownTimer = setTimeout(() => void close(), 0);
    return {};
  };
  app.onclose = () => {
    connected = false;
    if (closed || hostTeardownRequested) return;
    closed = true;
    setError('transport', new Error('MCP App transport closed unexpectedly'));
    void runTeardown();
  };
  app.onerror = (error) => {
    setError(connected ? 'transport' : 'initialization', error);
  };

  options.onStateChange?.(state);
  window.addEventListener('pagehide', handlePageHide);

  return {
    app,
    getState: () => state,
    subscribe(listener) {
      subscribers.add(listener);
      listener(state);
      return () => subscribers.delete(listener);
    },
    async connect() {
      if (closed) throw new Error('MCP App runtime is closed');
      if (connected) throw new Error('MCP App runtime is already connected');
      try {
        const transport =
          options.transport ?? new PostMessageTransport(window.parent, window.parent);
        await app.connect(transport);
        connected = true;
        const context = app.getHostContext();
        if (context) applyHostContext(context);
        if (options.autoResize !== false) resizeCleanup = app.setupSizeChangedNotifications();
      } catch (error) {
        setError('initialization', error);
        await close();
        throw error;
      }
    },
    close,
  };
}

import { AppBridge, type McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type {
  McpAppModelContext,
  McpAppRuntimeOptions,
  McpAppToolInput,
  McpAppToolResult,
} from '../../src/apps/index.js';
import { createMcpAppRuntime } from '../../src/apps/index.js';

interface TestHostOptions {
  readonly hostContext?: McpUiHostContext;
  readonly failInitialization?: Error;
  readonly failClose?: Error;
}

interface FakeStyle {
  colorScheme: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  height: string;
  setProperty(name: string, value: string): void;
  getPropertyValue(name: string): string;
  removeProperty(name: string): void;
}

function createStyle(): FakeStyle {
  const properties = new Map<string, string>();
  return {
    colorScheme: '',
    paddingTop: '',
    paddingRight: '',
    paddingBottom: '',
    paddingLeft: '',
    height: '',
    setProperty(name, value) {
      properties.set(name, value);
    },
    getPropertyValue(name) {
      return properties.get(name) ?? '';
    },
    removeProperty(name) {
      properties.delete(name);
    },
  };
}

function installBrowserFixture() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const elements = new Map<string, { id: string; textContent: string; remove(): void }>();
  const rootAttributes = new Map<string, string>();
  const rootStyle = createStyle();
  let activeResizeObservers = 0;

  const root = {
    style: rootStyle,
    classList: { contains: () => false },
    getAttribute: (name: string) => rootAttributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => rootAttributes.set(name, value),
    removeAttribute: (name: string) => rootAttributes.delete(name),
    getBoundingClientRect: () => ({ height: 100 }),
  };
  const body = { style: createStyle() };
  const head = {
    appendChild(element: { id: string; textContent: string; remove(): void }) {
      elements.set(element.id, element);
    },
  };
  const fakeDocument = {
    documentElement: root,
    body,
    head,
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: () => {
      const element = {
        id: '',
        textContent: '',
        remove() {
          elements.delete(element.id);
        },
      };
      return element;
    },
  };
  const fakeWindow = {
    parent: undefined as unknown,
    innerWidth: 640,
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const entries = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(listener);
    },
  };
  fakeWindow.parent = fakeWindow;

  class FakeResizeObserver {
    private active = true;
    constructor(_callback: ResizeObserverCallback) {
      void _callback;
      activeResizeObservers += 1;
    }
    observe() {}
    unobserve() {}
    disconnect() {
      if (this.active) activeResizeObservers -= 1;
      this.active = false;
    }
  }

  Object.assign(globalThis, {
    window: fakeWindow,
    document: fakeDocument,
    ResizeObserver: FakeResizeObserver,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });

  return {
    listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
    dispatch(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === 'function') listener(new Event(type));
        else listener.handleEvent(new Event(type));
      }
    },
    activeResizeObserverCount: () => activeResizeObservers,
    rootAttribute: (name: string) => root.getAttribute(name),
    rootStyle: (name: string) => rootStyle.getPropertyValue(name),
    safeAreaPadding: () => ({
      top: rootStyle.paddingTop,
      right: rootStyle.paddingRight,
      bottom: rootStyle.paddingBottom,
      left: rootStyle.paddingLeft,
    }),
    hasHostFonts: () => elements.has('__mcp-host-fonts'),
    restore() {
      Object.assign(globalThis, {
        window: originalWindow,
        document: originalDocument,
        ResizeObserver: originalResizeObserver,
        requestAnimationFrame: originalRequestAnimationFrame,
      });
    },
  };
}

export function createMcpAppTestHost(
  runtimeOptions: Omit<McpAppRuntimeOptions, 'transport' | 'styleRoot' | 'safeAreaElement'>,
  hostOptions: TestHostOptions = {},
) {
  const browser = installBrowserFixture();
  const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();
  const initializationFailure = hostOptions.failInitialization;
  let hostConnectionOpen = false;
  const closeFailure = hostOptions.failClose;
  if (closeFailure) {
    appTransport.close = () => {
      appTransport.onclose?.();
      return Promise.reject(closeFailure);
    };
  }
  const runtime = createMcpAppRuntime({
    ...runtimeOptions,
    transport: initializationFailure
      ? {
          start() {
            return Promise.reject(initializationFailure);
          },
          send() {
            return Promise.resolve();
          },
          close() {
            return Promise.resolve();
          },
        }
      : appTransport,
  });
  const bridge = new AppBridge(
    null,
    { name: 'mcp-kit-test-host', version: '1.0.0' },
    { updateModelContext: { text: {}, structuredContent: {} } },
    hostOptions.hostContext ? { hostContext: hostOptions.hostContext } : undefined,
  );
  const modelContextUpdates: McpAppModelContext[] = [];
  bridge.onupdatemodelcontext = (params) => {
    modelContextUpdates.push(params);
    return Promise.resolve({});
  };

  return {
    runtime,
    async connect() {
      if (!hostOptions.failInitialization) {
        await bridge.connect(hostTransport);
        hostConnectionOpen = true;
      }
      await runtime.connect();
    },
    sendToolInput(input: McpAppToolInput) {
      return bridge.sendToolInput(input);
    },
    sendToolResult(result: McpAppToolResult) {
      return bridge.sendToolResult(result);
    },
    modelContextUpdates,
    emitTransportError(error: Error) {
      appTransport.onerror?.(error);
    },
    async closePeer() {
      await hostTransport.close();
      hostConnectionOpen = false;
    },
    async closeRuntime() {
      await runtime.close();
      hostConnectionOpen = false;
    },
    async requestHostTeardown() {
      await bridge.teardownResource({});
      await new Promise((resolve) => setTimeout(resolve, 0));
      hostConnectionOpen = false;
    },
    async dispatchPageHide() {
      browser.dispatch('pagehide');
      await new Promise((resolve) => setTimeout(resolve, 0));
      hostConnectionOpen = false;
    },
    async teardown() {
      if (hostConnectionOpen) {
        await bridge.teardownResource({}).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!hostOptions.failInitialization) await bridge.close().catch(() => undefined);
      await runtime.close().catch(() => undefined);
      browser.restore();
    },
    pendingListenerCount: browser.listenerCount,
    activeResizeObserverCount: browser.activeResizeObserverCount,
    rootAttribute: browser.rootAttribute,
    rootStyle: browser.rootStyle,
    safeAreaPadding: browser.safeAreaPadding,
    hasHostFonts: browser.hasHostFonts,
  };
}

import { createMcpAppTestHost } from './host-fixture.js';

describe('MCP Apps browser runtime', () => {
  it('starts without fixture data and follows loading, ready, error, and teardown states', async () => {
    const states: string[] = [];
    const fixture = createMcpAppTestHost(
      {
        appInfo: { name: 'neutral-runtime-test', version: '1.0.0' },
        onStateChange(state) {
          states.push(state.status);
        },
      },
      {
        hostContext: {
          theme: 'dark',
          safeAreaInsets: { top: 1, right: 2, bottom: 3, left: 4 },
          styles: {
            variables: { '--color-background-primary': '#111111' },
            css: { fonts: '@font-face { font-family: TestHost; src: local(system-ui); }' },
          },
        },
      },
    );

    expect(fixture.runtime.getState()).toEqual({ status: 'loading' });

    await fixture.connect();
    expect(fixture.rootAttribute('data-theme')).toBe('dark');
    expect(fixture.rootStyle('--color-background-primary')).toBe('#111111');
    expect(fixture.safeAreaPadding()).toEqual({
      top: '1px',
      right: '2px',
      bottom: '3px',
      left: '4px',
    });
    expect(fixture.hasHostFonts()).toBe(true);
    await fixture.sendToolInput({ arguments: {} });
    expect(fixture.runtime.getState()).toEqual({ status: 'loading' });

    const result = {
      content: [{ type: 'text' as const, text: 'neutral result' }],
      structuredContent: { value: 'from-host' },
    };
    await fixture.sendToolResult(result);
    expect(fixture.runtime.getState()).toEqual({ status: 'ready', result });
    fixture.emitTransportError(new Error('transport disconnected'));
    expect(fixture.runtime.getState()).toEqual({
      status: 'error',
      error: { kind: 'transport', message: 'transport disconnected' },
    });
    expect(states).toEqual(['loading', 'ready', 'error']);

    await fixture.teardown();
    expect(fixture.pendingListenerCount()).toBe(0);
    expect(fixture.activeResizeObserverCount()).toBe(0);
    expect(fixture.rootAttribute('data-theme')).toBeNull();
    expect(fixture.rootStyle('--color-background-primary')).toBe('');
    expect(fixture.safeAreaPadding()).toEqual({ top: '', right: '', bottom: '', left: '' });
    expect(fixture.hasHostFonts()).toBe(false);
  });

  it('reports initialization failure without substituting fixture business data', async () => {
    const fixture = createMcpAppTestHost(
      { appInfo: { name: 'failure-test', version: '1.0.0' } },
      { failInitialization: new Error('host unavailable') },
    );

    await expect(fixture.connect()).rejects.toThrow('host unavailable');
    const state = fixture.runtime.getState();
    expect(state.status).toBe('error');
    if (state.status === 'error') {
      expect(state.error).toEqual({ kind: 'initialization', message: 'host unavailable' });
    }
    expect('result' in state).toBe(false);

    await fixture.teardown();
  });

  it('reports an unexpected peer close as a transport error and cleans browser resources', async () => {
    const fixture = createMcpAppTestHost({
      appInfo: { name: 'peer-close-test', version: '1.0.0' },
    });

    await fixture.connect();
    await fixture.sendToolResult({ content: [{ type: 'text', text: 'ready' }] });
    expect(fixture.runtime.getState().status).toBe('ready');
    expect(fixture.pendingListenerCount()).toBe(1);
    expect(fixture.activeResizeObserverCount()).toBe(1);

    await fixture.closePeer();

    expect(fixture.runtime.getState()).toEqual({
      status: 'error',
      error: { kind: 'transport', message: 'MCP App transport closed unexpectedly' },
    });
    expect(fixture.pendingListenerCount()).toBe(0);
    expect(fixture.activeResizeObserverCount()).toBe(0);

    await fixture.teardown();
  });

  it('does not misclassify explicit close or host teardown as transport failure', async () => {
    const explicit = createMcpAppTestHost({
      appInfo: { name: 'explicit-close-test', version: '1.0.0' },
    });
    await explicit.connect();
    await explicit.sendToolResult({ content: [{ type: 'text', text: 'ready' }] });
    await explicit.closeRuntime();
    expect(explicit.runtime.getState().status).toBe('ready');
    expect(explicit.pendingListenerCount()).toBe(0);
    expect(explicit.activeResizeObserverCount()).toBe(0);
    await explicit.teardown();

    const host = createMcpAppTestHost({
      appInfo: { name: 'host-teardown-test', version: '1.0.0' },
    });
    await host.connect();
    await host.sendToolResult({ content: [{ type: 'text', text: 'ready' }] });
    await host.requestHostTeardown();
    expect(host.runtime.getState().status).toBe('ready');
    expect(host.pendingListenerCount()).toBe(0);
    expect(host.activeResizeObserverCount()).toBe(0);
    await host.teardown();
  });

  it('classifies close rejection as teardown failure without rejecting pagehide cleanup', async () => {
    const fixture = createMcpAppTestHost(
      { appInfo: { name: 'close-rejection-test', version: '1.0.0' } },
      { failClose: new Error('transport close failed') },
    );

    await fixture.connect();
    await fixture.dispatchPageHide();

    expect(fixture.runtime.getState()).toEqual({
      status: 'error',
      error: { kind: 'teardown', message: 'transport close failed' },
    });
    await expect(fixture.closeRuntime()).resolves.toBeUndefined();
    expect(fixture.pendingListenerCount()).toBe(0);
    expect(fixture.activeResizeObserverCount()).toBe(0);

    await fixture.teardown();
  });
});

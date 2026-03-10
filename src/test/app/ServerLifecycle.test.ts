import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { ServerConfig } from '@core/types/domain';
import type { Logger } from '@core/types/logger';
import { ok } from '@core/result';
import { ErrorCode } from '@core/errors/codes';
import type { HookConfig } from '@core/types/domain';

/* ── helpers ─────────────────────────────────────────────────────────────── */

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeServer(id = 'srv-1', name = 'My Tomcat'): ServerConfig {
  return {
    id,
    name,
    type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/opt/tomcat', version: '10.1' },
    instancePath: '/tmp/inst',
    javaHome: '/usr/lib/jvm/java-17',
    host: '127.0.0.1',
    ports: { http: 8080, debug: 5005 },
    run: { env: {}, vmArgs: [] },
    debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
    deployments: [],
    autosync: {
      enabled: true,
      debounceMs: 400,
      maxBatchFiles: 200,
      maxBatchBytes: 20_000_000,
      stormBackoffMs: 2000,
      ignoreGlobs: [],
    },
    hooks: [],
  };
}

function mockBus() {
  return {
    emit: vi.fn(),
    on: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };
}

function mockPluginRegistry() {
  return {
    register: vi.fn(),
    get: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      getStatus: vi.fn(),
      detect: vi.fn(),
    })),
    has: vi.fn(() => true),
  };
}

function mockPidManager() {
  return {
    writePid: vi.fn(async () => {}),
    readPid: vi.fn(async () => null as number | null),
    clearPid: vi.fn(async () => {}),
    isProcessAlive: vi.fn(() => false),
  };
}

function mockPortScanner() {
  return { probe: vi.fn(async () => false) };
}

function mockDebugAttacher() {
  return { attach: vi.fn(async () => {}), detach: vi.fn(async () => {}) };
}

function mockQueue(serverId = 'srv-1') {
  return {
    serverId,
    setExecutor: vi.fn(),
    enqueue: vi.fn(),
    clear: vi.fn(),
    isRunning: false,
    size: 0,
    activeKind: null,
  };
}

function mockHookRunner() {
  return {
    runHooks: vi.fn(async () => ok({ executed: 0, skipped: 0, failed: 0, errors: [] })),
  };
}

function makeHook(event: HookConfig['event']): HookConfig {
  return {
    id: `hook-${event}`,
    enabled: true,
    phase: 'pre',
    event,
    kind: 'command',
    timeoutMs: 60_000,
    continueOnError: false,
    command: { mode: 'shell', line: 'echo ok' },
  };
}

/* ── tests ───────────────────────────────────────────────────────────────── */

describe('ServerLifecycle', () => {
  let bus: ReturnType<typeof mockBus>;
  let pluginRegistry: ReturnType<typeof mockPluginRegistry>;
  let pidManager: ReturnType<typeof mockPidManager>;
  let portScanner: ReturnType<typeof mockPortScanner>;
  let debugAttacher: ReturnType<typeof mockDebugAttacher>;
  let hookRunner: ReturnType<typeof mockHookRunner>;
  let lifecycle: ServerLifecycle;

  beforeEach(() => {
    bus = mockBus();
    pluginRegistry = mockPluginRegistry();
    pidManager = mockPidManager();
    portScanner = mockPortScanner();
    debugAttacher = mockDebugAttacher();
    hookRunner = mockHookRunner();

    lifecycle = new ServerLifecycle({
      pluginRegistry: pluginRegistry as never,
      bus: bus as never,
      pidManager: pidManager as never,
      portScanner: portScanner as never,
      debugAttacher: debugAttacher as never,
      logger: mockLogger(),
      hookRunner: hookRunner as never,
    });
  });

  /* ── register ────────────────────────────────────────────────────── */

  describe('register', () => {
    it('returns a ServerRuntime in stopped state', () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      expect(runtime.state).toBe('stopped');
    });

    it('wires the queue executor', () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);
      expect(queue.setExecutor).toHaveBeenCalledOnce();
    });

    it('routes operation output to the injected per-server sink', async () => {
      const append = vi.fn();
      const appendLine = vi.fn();
      const clear = vi.fn();
      const queue = mockQueue();
      const logger = mockLogger();
      const pluginStart = vi.fn(async (ctx: any) => {
        ctx.progress.report('Starting Tomcat...');
        ctx.output.appendLine('catalina output');
        return ok({
          pid: 123,
          httpUrl: 'http://127.0.0.1:8080',
          hints: [],
        });
      });

      pluginRegistry.get.mockReturnValue({
        start: pluginStart,
        stop: vi.fn(),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      portScanner.probe.mockResolvedValue(true);

      lifecycle = new ServerLifecycle({
        pluginRegistry: pluginRegistry as never,
        bus: bus as never,
        pidManager: pidManager as never,
        portScanner: portScanner as never,
        debugAttacher: debugAttacher as never,
        logger,
        getOutputSink: () => ({ append, appendLine, clear }),
      });

      lifecycle.register('srv-1', makeServer(), queue as never);
      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;

      await executor({ kind: 'LifecycleStart', meta: { mode: 'run' } });

      expect(pluginStart).toHaveBeenCalledOnce();
      expect(appendLine).toHaveBeenCalledWith('Starting Tomcat...');
      expect(appendLine).toHaveBeenCalledWith('catalina output');
      expect(clear).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith('[srv-1] Starting Tomcat...');
      expect(logger.debug).not.toHaveBeenCalledWith('catalina output');
    });

    it('runs lifecycle.start hooks during the real start flow', async () => {
      const queue = mockQueue();
      const config = {
        ...makeServer(),
        hooks: [
          makeHook('lifecycle.start'),
          { ...makeHook('lifecycle.start'), id: 'hook-post', phase: 'post' },
        ],
      };
      const pluginStart = vi.fn(async () => ok({
        pid: 123,
        httpUrl: 'http://127.0.0.1:8080',
        hints: [],
      }));

      pluginRegistry.get.mockReturnValue({
        start: pluginStart,
        stop: vi.fn(),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      portScanner.probe.mockResolvedValue(true);

      lifecycle.register('srv-1', config, queue as never);
      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;

      await executor({ kind: 'LifecycleStart', meta: { mode: 'run' } });

      expect(hookRunner.runHooks).toHaveBeenNthCalledWith(1, 'srv-1', 'pre', 'lifecycle.start', config.hooks);
      expect(hookRunner.runHooks).toHaveBeenNthCalledWith(2, 'srv-1', 'post', 'lifecycle.start', config.hooks);
    });

    it('runs only lifecycle.restart hooks for restart operations', async () => {
      const queue = mockQueue();
      const config = {
        ...makeServer(),
        hooks: [
          makeHook('lifecycle.restart'),
          { ...makeHook('lifecycle.restart'), id: 'hook-restart-post', phase: 'post' },
        ],
      };
      const pluginStart = vi.fn(async () => ok({
        pid: 123,
        httpUrl: 'http://127.0.0.1:8080',
        hints: [],
      }));
      const pluginStop = vi.fn(async () => ok(undefined));

      pluginRegistry.get.mockReturnValue({
        start: pluginStart,
        stop: pluginStop,
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      portScanner.probe.mockResolvedValue(true);

      const runtime = lifecycle.register('srv-1', config, queue as never);
      runtime.forceState('running', { pid: 321 });
      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;

      await executor({ kind: 'LifecycleRestart', meta: { mode: 'run' } });

      expect(hookRunner.runHooks).toHaveBeenNthCalledWith(1, 'srv-1', 'pre', 'lifecycle.restart', config.hooks);
      expect(hookRunner.runHooks).toHaveBeenNthCalledWith(2, 'srv-1', 'post', 'lifecycle.restart', config.hooks);
      expect(hookRunner.runHooks).toHaveBeenCalledTimes(2);
    });
  });

  /* ── getRuntime ──────────────────────────────────────────────────── */

  describe('getRuntime', () => {
    it('returns runtime for registered server', () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);
      expect(lifecycle.getRuntime('srv-1')).toBeDefined();
    });

    it('returns undefined for unknown server', () => {
      expect(lifecycle.getRuntime('nope')).toBeUndefined();
    });
  });

  /* ── start / stop state guards ───────────────────────────────────── */

  describe('start', () => {
    it('enqueues start for stopped server', () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);

      const result = lifecycle.start('srv-1', 'run');
      expect(result.ok).toBe(true);
      expect(queue.enqueue).toHaveBeenCalledWith({
        kind: 'LifecycleStart',
        meta: { mode: 'run' },
      });
    });

    it('rejects start for unknown server', () => {
      const result = lifecycle.start('nope', 'run');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.InvalidConfig);
    });

    it('rejects start when server is already running', () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      // Force to running state for the guard check
      runtime.forceState('running', { pid: 123 });

      const result = lifecycle.start('srv-1', 'run');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.AlreadyRunning);
    });
  });

  describe('stop', () => {
    it('enqueues stop for running server', () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });

      const result = lifecycle.stop('srv-1');
      expect(result.ok).toBe(true);
      expect(queue.enqueue).toHaveBeenCalledWith({ kind: 'LifecycleStop' });
    });

    it('rejects stop for stopped server', () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);

      const result = lifecycle.stop('srv-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.NotRunning);
    });

    it('rejects stop for unknown server', () => {
      const result = lifecycle.stop('nope');
      expect(result.ok).toBe(false);
    });
  });

  describe('restart', () => {
    it('enqueues restart', () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);

      const result = lifecycle.restart('srv-1', 'debug');
      expect(result.ok).toBe(true);
      expect(queue.enqueue).toHaveBeenCalledWith({
        kind: 'LifecycleRestart',
        meta: { mode: 'debug' },
      });
    });

    it('rejects restart for unknown server', () => {
      const result = lifecycle.restart('nope', 'run');
      expect(result.ok).toBe(false);
    });
  });

  /* ── cancel ──────────────────────────────────────────────────────── */

  describe('cancel', () => {
    it('clears the queue for registered server', () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);
      lifecycle.cancel('srv-1');
      expect(queue.clear).toHaveBeenCalledOnce();
    });

    it('does nothing for unknown server', () => {
      // Should not throw
      lifecycle.cancel('nope');
    });
  });

  /* ── updateConfig / unregister ───────────────────────────────────── */

  describe('updateConfig', () => {
    it('updates config reference', () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);
      const updated = makeServer('srv-1', 'New Name');
      lifecycle.updateConfig('srv-1', updated);
      // If getRuntime still works, config was accepted
      expect(lifecycle.getRuntime('srv-1')).toBeDefined();
    });
  });

  describe('unregister', () => {
    it('removes server from management', () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);
      lifecycle.unregister('srv-1');
      expect(lifecycle.getRuntime('srv-1')).toBeUndefined();
    });
  });

  /* ── reconcileRunningServers ─────────────────────────────────────── */

  describe('reconcileRunningServers', () => {
    it('marks server stopped when no PID file', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);

      pidManager.readPid.mockResolvedValue(null);

      await lifecycle.reconcileRunningServers([{ serverKey: 'srv-1', config: makeServer() }]);

      expect(runtime.state).toBe('stopped');
      expect(bus.emit).toHaveBeenCalledWith('WorkspaceLoaded', { serverCount: 1 });
    });

    it('marks server running when PID is alive', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);

      pidManager.readPid.mockResolvedValue(42);
      pidManager.isProcessAlive.mockReturnValue(true);

      await lifecycle.reconcileRunningServers([{ serverKey: 'srv-1', config: makeServer() }]);

      expect(runtime.state).toBe('running');
    });

    it('clears stale PID and marks stopped', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);

      pidManager.readPid.mockResolvedValue(42);
      pidManager.isProcessAlive.mockReturnValue(false);

      await lifecycle.reconcileRunningServers([{ serverKey: 'srv-1', config: makeServer() }]);

      expect(runtime.state).toBe('stopped');
      expect(pidManager.clearPid).toHaveBeenCalledWith('srv-1');
    });

    it('emits WorkspaceLoaded', async () => {
      await lifecycle.reconcileRunningServers([]);
      expect(bus.emit).toHaveBeenCalledWith('WorkspaceLoaded', { serverCount: 0 });
    });
  });

  /* ── refreshStatus ───────────────────────────────────────────────── */

  describe('refreshStatus', () => {
    it('enqueues StatusRefresh for registered server', () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);
      const result = lifecycle.refreshStatus('srv-1');
      expect(result.ok).toBe(true);
      expect(queue.enqueue).toHaveBeenCalledWith({ kind: 'StatusRefresh' });
    });

    it('rejects for unknown server', () => {
      const result = lifecycle.refreshStatus('nope');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.InvalidConfig);
    });
  });

  /* ── TrustGate (§12.8) ──────────────────────────────────────────── */

  describe('TrustGate', () => {
    let untrustedLifecycle: ServerLifecycle;

    beforeEach(() => {
      untrustedLifecycle = new ServerLifecycle({
        pluginRegistry: pluginRegistry as never,
        bus: bus as never,
        pidManager: pidManager as never,
        portScanner: portScanner as never,
        debugAttacher: debugAttacher as never,
        logger: mockLogger(),
        trustGate: { isTrusted: () => false },
      });
    });

    it('blocks start in untrusted workspace', () => {
      const queue = mockQueue();
      untrustedLifecycle.register('srv-1', makeServer(), queue as never);
      const result = untrustedLifecycle.start('srv-1', 'run');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    });

    it('blocks stop in untrusted workspace', () => {
      const queue = mockQueue();
      const runtime = untrustedLifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });
      const result = untrustedLifecycle.stop('srv-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    });

    it('blocks restart in untrusted workspace', () => {
      const queue = mockQueue();
      untrustedLifecycle.register('srv-1', makeServer(), queue as never);
      const result = untrustedLifecycle.restart('srv-1', 'run');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    });

    it('allows operations when trusted', () => {
      const trustedLifecycle = new ServerLifecycle({
        pluginRegistry: pluginRegistry as never,
        bus: bus as never,
        pidManager: pidManager as never,
        portScanner: portScanner as never,
        debugAttacher: debugAttacher as never,
        logger: mockLogger(),
        trustGate: { isTrusted: () => true },
      });
      const queue = mockQueue();
      trustedLifecycle.register('srv-1', makeServer(), queue as never);
      const result = trustedLifecycle.start('srv-1', 'run');
      expect(result.ok).toBe(true);
    });
  });
});

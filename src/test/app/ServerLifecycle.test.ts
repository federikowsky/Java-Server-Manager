import { spawnSync } from 'child_process';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { ServerConfig } from '@core/types/domain';
import type { Logger } from '@core/types/logger';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { HookConfig } from '@core/types/domain';
import type { StartupMonitor } from '@plugins/interfaces/IServerPlugin';
import { OperationQueue } from '@core/ops/OperationQueue';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();

  return {
    ...actual,
    spawnSync: vi.fn(() => ({
      pid: 0,
      output: [null, Buffer.alloc(0), Buffer.alloc(0)],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: 0,
      signal: null,
    })),
  };
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

const spawnSyncMock = vi.mocked(spawnSync);

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
    readPidRecord: vi.fn(async () => undefined),
    clearPid: vi.fn(async () => {}),
    isProcessAlive: vi.fn(() => false),
    isPidRecordCurrent: vi.fn(() => false),
  };
}

function mockPortScanner() {
  return { probe: vi.fn(async () => false), findFreePort: vi.fn(async () => null) };
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

function mockDeployService() {
  return {
    fullRedeploy: vi.fn(async () => ok(undefined)),
    rollback: vi.fn(async () => ok(undefined)),
    undeploy: vi.fn(async () => ok(undefined)),
    redeployAll: vi.fn(async () => {}),
    deployUndeployed: vi.fn(async () => {}),
    runHealthChecksForServer: vi.fn(async () => {}),
    sync: vi.fn(async () => ok(undefined)),
    getDeploymentState: vi.fn(() => 'undeployed' as const),
    getDeploymentHealth: vi.fn(),
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
  let deployService: ReturnType<typeof mockDeployService>;
  let logger: ReturnType<typeof mockLogger>;
  let lifecycle: ServerLifecycle;

  beforeEach(() => {
    spawnSyncMock.mockClear();

    bus = mockBus();
    pluginRegistry = mockPluginRegistry();
    pidManager = mockPidManager();
    portScanner = mockPortScanner();
    debugAttacher = mockDebugAttacher();
    hookRunner = mockHookRunner();
    deployService = mockDeployService();
    logger = mockLogger();

    lifecycle = new ServerLifecycle({
      pluginRegistry: pluginRegistry as never,
      bus: bus as never,
      pidManager: pidManager as never,
      portScanner: portScanner as never,
      debugAttacher: debugAttacher as never,
      logger,
      hookRunner: hookRunner as never,
      deployService: deployService as never,
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
        deployService: mockDeployService() as never,
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

      const [preCall, postCall] = hookRunner.runHooks.mock.calls;
      expect(preCall[0]).toEqual(expect.objectContaining({
        phase: 'pre',
        event: 'lifecycle.start',
        hooks: config.hooks,
        parent: expect.objectContaining({
          serverId: 'srv-1',
          kind: 'LifecycleStart',
        }),
      }));
      expect(postCall[0]).toEqual(expect.objectContaining({
        phase: 'post',
        event: 'lifecycle.start',
        hooks: config.hooks,
      }));
      expect(postCall[0].parent).toBe(preCall[0].parent);
    });

    it('uses startupMonitor when provided and skips readiness probing', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      const startupMonitor: StartupMonitor = {
        waitForOutcome: vi.fn(async () => ({ state: 'started' })),
        dispose: vi.fn(async () => {}),
      };
      const pluginStart = vi.fn(async () => ok({
        pid: 123,
        httpUrl: 'http://127.0.0.1:8080',
        hints: [],
        startupMonitor,
      }));

      pluginRegistry.get.mockReturnValue({
        start: pluginStart,
        stop: vi.fn(),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      portScanner.probe.mockResolvedValue(true);

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await executor({ kind: 'LifecycleStart', meta: { mode: 'run' } });

      expect(startupMonitor.waitForOutcome).toHaveBeenCalledOnce();
      expect(startupMonitor.dispose).toHaveBeenCalledOnce();
      expect(portScanner.probe).toHaveBeenCalled();
      expect(runtime.state).toBe('running');
    });

    it('transitions to error when startupMonitor reports started but HTTP never becomes ready', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', {
        ...makeServer(),
        timeouts: { startRunMs: 1, stopMs: 20_000 },
      } as ServerConfig, queue as never);
      const startupMonitor: StartupMonitor = {
        waitForOutcome: vi.fn(async () => ({ state: 'started' })),
        dispose: vi.fn(async () => {}),
      };

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(async () => ok({
          pid: 123,
          httpUrl: 'http://127.0.0.1:8080',
          hints: [],
          startupMonitor,
        })),
        stop: vi.fn(),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      portScanner.probe.mockResolvedValue(false);

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await expect(executor({ kind: 'LifecycleStart', meta: { mode: 'run' } })).rejects.toMatchObject({
        code: ErrorCode.Timeout,
      });

      expect(runtime.state).toBe('error');
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleStart',
        error: expect.objectContaining({ code: ErrorCode.Timeout }),
      }));
      expect(startupMonitor.dispose).toHaveBeenCalledOnce();
    });

    it('clears persisted PID and performs best-effort cleanup when readiness times out after spawn', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', {
        ...makeServer(),
        timeouts: { startRunMs: 1, stopMs: 20_000 },
      } as ServerConfig, queue as never);
      const startupMonitor: StartupMonitor = {
        waitForOutcome: vi.fn(async () => ({ state: 'started' })),
        dispose: vi.fn(async () => {}),
      };
      const pluginStop = vi.fn(async () => ok(undefined));

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(async () => ok({
          pid: 123,
          httpUrl: 'http://127.0.0.1:8080',
          hints: [],
          startupMonitor,
        })),
        stop: pluginStop,
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      portScanner.probe.mockResolvedValue(false);

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await expect(executor({ kind: 'LifecycleStart', meta: { mode: 'run' } })).rejects.toMatchObject({
        code: ErrorCode.Timeout,
      });

      expect(pidManager.writePid).toHaveBeenCalledWith('srv-1', 123, {
        instancePath: '/tmp/inst',
        runtimeHomePath: '/opt/tomcat',
      });
      expect(pluginStop).toHaveBeenCalledOnce();
      expect(pidManager.clearPid).toHaveBeenCalledWith('srv-1');
      expect(debugAttacher.detach).toHaveBeenCalledWith('srv-1');
      expect(runtime.state).toBe('error');
    });

    it('transitions to error when startupMonitor reports failure', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      const startupError = new JsmError({
        code: ErrorCode.ProcessSpawnFailed,
        message: 'Tomcat startup failed',
      });
      const startupMonitor: StartupMonitor = {
        waitForOutcome: vi.fn(async () => ({ state: 'failed', error: startupError })),
        dispose: vi.fn(async () => {}),
      };

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(async () => ok({
          pid: 123,
          httpUrl: 'http://127.0.0.1:8080',
          hints: [],
          startupMonitor,
        })),
        stop: vi.fn(),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await expect(executor({ kind: 'LifecycleStart', meta: { mode: 'run' } })).rejects.toBe(startupError);

      expect(runtime.state).toBe('error');
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleStart',
        error: startupError,
      }));
      expect(startupMonitor.dispose).toHaveBeenCalledOnce();
    });

    it('cancels an active start operation instead of only clearing queued work', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      const pluginStop = vi.fn(async () => ok(undefined));
      const pluginStart = vi.fn(async () => ok({
        pid: 123,
        httpUrl: 'http://127.0.0.1:8080',
        hints: [],
      }));

      pluginRegistry.get.mockReturnValue({
        start: pluginStart,
        stop: pluginStop,
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      portScanner.probe.mockResolvedValue(false);

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      const running = executor({ kind: 'LifecycleStart', meta: { mode: 'run' } });

      await vi.waitFor(() => {
        expect(runtime.state).toBe('starting');
      });

      lifecycle.cancel('srv-1');
      await expect(running).rejects.toMatchObject({ code: ErrorCode.Cancelled });

      expect(queue.clear).toHaveBeenCalledOnce();
      expect(pluginStop).toHaveBeenCalledOnce();
      expect(pidManager.clearPid).toHaveBeenCalledWith('srv-1');
      expect(debugAttacher.detach).toHaveBeenCalledWith('srv-1');
      expect(runtime.state).toBe('error');
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleStart',
        error: expect.objectContaining({ code: ErrorCode.Cancelled }),
      }));
    });

    it('transitions to error when plugin health check returns an error result', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      const healthError = new JsmError({
        code: ErrorCode.ValidationFailed,
        message: 'plugin health failed',
      });
      const pluginStop = vi.fn(async () => ok(undefined));

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(async () => ok({
          pid: 123,
          httpUrl: 'http://127.0.0.1:8080',
          hints: [],
        })),
        stop: pluginStop,
        getStatus: vi.fn(),
        detect: vi.fn(),
        healthCheck: vi.fn(async () => err(healthError)),
      });
      portScanner.probe.mockResolvedValue(true);

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await expect(executor({ kind: 'LifecycleStart', meta: { mode: 'run' } })).rejects.toBe(healthError);

      expect(runtime.state).toBe('error');
      expect(deployService.runHealthChecksForServer).not.toHaveBeenCalled();
      expect(pluginStop).toHaveBeenCalledOnce();
      expect(pidManager.clearPid).toHaveBeenCalledWith('srv-1');
      expect(debugAttacher.detach).toHaveBeenCalledWith('srv-1');
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleStart',
        error: healthError,
      }));
    });

    it('does not fire lifecycle.stop hooks during failed-start cleanup', async () => {
      const queue = mockQueue();
      const healthError = new JsmError({
        code: ErrorCode.ValidationFailed,
        message: 'plugin health failed',
      });
      const config = {
        ...makeServer(),
        hooks: [
          makeHook('lifecycle.start'),
          { ...makeHook('lifecycle.start'), id: 'hook-start-on-error', phase: 'onError' },
          { ...makeHook('lifecycle.stop'), id: 'hook-stop-pre' },
          { ...makeHook('lifecycle.stop'), id: 'hook-stop-post', phase: 'post' },
          { ...makeHook('lifecycle.stop'), id: 'hook-stop-on-error', phase: 'onError' },
        ],
      };
      const pluginStop = vi.fn(async () => ok(undefined));

      lifecycle.register('srv-1', config, queue as never);
      pluginRegistry.get.mockReturnValue({
        start: vi.fn(async () => ok({
          pid: 123,
          httpUrl: 'http://127.0.0.1:8080',
          hints: [],
        })),
        stop: pluginStop,
        getStatus: vi.fn(),
        detect: vi.fn(),
        healthCheck: vi.fn(async () => err(healthError)),
      });
      portScanner.probe.mockResolvedValue(true);

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await expect(executor({ kind: 'LifecycleStart', meta: { mode: 'run' } })).rejects.toBe(healthError);

      expect(pluginStop).toHaveBeenCalledOnce();
      expect(hookRunner.runHooks.mock.calls.map(([call]) => `${call.phase}:${call.event}`)).toEqual([
        'pre:lifecycle.start',
        'onError:lifecycle.start',
      ]);
    });

    it('transitions to error when plugin health check reports unhealthy', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(async () => ok({
          pid: 123,
          httpUrl: 'http://127.0.0.1:8080',
          hints: [],
        })),
        stop: vi.fn(),
        getStatus: vi.fn(),
        detect: vi.fn(),
        healthCheck: vi.fn(async () => ok({ ok: false })),
      });
      portScanner.probe.mockResolvedValue(true);

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await expect(executor({ kind: 'LifecycleStart', meta: { mode: 'run' } })).rejects.toMatchObject({
        code: ErrorCode.ValidationFailed,
        message: 'Health check failed: server not responding',
      });

      expect(runtime.state).toBe('error');
      expect(deployService.runHealthChecksForServer).not.toHaveBeenCalled();
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleStart',
        error: expect.objectContaining({
          code: ErrorCode.ValidationFailed,
          message: 'Health check failed: server not responding',
        }),
      }));
    });

    it('runs deployment health checks only after runtime reaches running', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      let runtimeStateAtDeploymentHealthCheck: string | undefined;

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(async () => ok({
          pid: 123,
          httpUrl: 'http://127.0.0.1:8080',
          hints: [],
        })),
        stop: vi.fn(),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      portScanner.probe.mockResolvedValue(true);
      deployService.runHealthChecksForServer.mockImplementation(async () => {
        runtimeStateAtDeploymentHealthCheck = runtime.state;
      });

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await executor({ kind: 'LifecycleStart', meta: { mode: 'run' } });

      expect(runtime.state).toBe('running');
      expect(runtimeStateAtDeploymentHealthCheck).toBe('running');
    });

    it('transitions to error when start is cancelled before debugger attach', async () => {
      const queue = mockQueue();
      const baseConfig = makeServer();
      const config = {
        ...baseConfig,
        debug: { ...baseConfig.debug, attachDelayMs: 10_000 },
      };
      const runtime = lifecycle.register('srv-1', config, queue as never);

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(async () => ok({
          pid: 123,
          httpUrl: 'http://127.0.0.1:8080',
          hints: [],
        })),
        stop: vi.fn(),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      portScanner.probe.mockResolvedValue(true);
      debugAttacher.attach.mockResolvedValue(ok(undefined));

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      const running = executor({ kind: 'LifecycleStart', meta: { mode: 'debug' } });

      await vi.waitFor(() => {
        expect(runtime.state).toBe('running');
      });

      lifecycle.cancel('srv-1');
      await expect(running).rejects.toMatchObject({ code: ErrorCode.Cancelled });

      expect(debugAttacher.attach).not.toHaveBeenCalled();
      expect(runtime.state).toBe('error');
      expect(runtime.debugAttached).toBe(false);
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleStart',
        error: expect.objectContaining({ code: ErrorCode.Cancelled }),
      }));
    });

    it('runs only lifecycle.restart hooks and preserves restart ordering around internal stop/start', async () => {
      const queue = mockQueue();
      const config = {
        ...makeServer(),
        hooks: [
          makeHook('lifecycle.restart'),
          { ...makeHook('lifecycle.restart'), id: 'hook-restart-post', phase: 'post' },
          { ...makeHook('lifecycle.start'), id: 'hook-start-pre' },
          { ...makeHook('lifecycle.stop'), id: 'hook-stop-pre' },
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

      const [preCall, postCall] = hookRunner.runHooks.mock.calls;
      expect(preCall[0]).toEqual(expect.objectContaining({
        phase: 'pre',
        event: 'lifecycle.restart',
        hooks: config.hooks,
        parent: expect.objectContaining({
          serverId: 'srv-1',
          kind: 'LifecycleRestart',
        }),
      }));
      expect(postCall[0]).toEqual(expect.objectContaining({
        phase: 'post',
        event: 'lifecycle.restart',
        hooks: config.hooks,
      }));
      expect(postCall[0].parent).toBe(preCall[0].parent);
      expect(hookRunner.runHooks).toHaveBeenCalledTimes(2);
      expect(hookRunner.runHooks.mock.calls.every(([call]) => call.event === 'lifecycle.restart')).toBe(true);
      expect(hookRunner.runHooks.mock.invocationCallOrder[0]).toBeLessThan(pluginStop.mock.invocationCallOrder[0]);
      expect(pluginStop.mock.invocationCallOrder[0]).toBeLessThan(pluginStart.mock.invocationCallOrder[0]);
      expect(pluginStart.mock.invocationCallOrder[0]).toBeLessThan(hookRunner.runHooks.mock.invocationCallOrder[1]);
    });

    it('keeps the server running when restart is cancelled before internal stop begins', async () => {
      const queue = mockQueue();
      const config = {
        ...makeServer(),
        hooks: [
          makeHook('lifecycle.restart'),
          { ...makeHook('lifecycle.restart'), id: 'hook-restart-on-error', phase: 'onError' },
        ],
      };
      const pluginStart = vi.fn(async () => ok({
        pid: 123,
        httpUrl: 'http://127.0.0.1:8080',
        hints: [],
      }));
      const pluginStop = vi.fn(async () => ok(undefined));
      let releaseRestartPreHook: (() => void) | undefined;
      const waitForRestartPreHook = new Promise<void>((resolve) => {
        releaseRestartPreHook = resolve;
      });

      hookRunner.runHooks.mockImplementation(async ({ phase, event }) => {
        if (phase === 'pre' && event === 'lifecycle.restart') {
          await waitForRestartPreHook;
        }
        return ok({ executed: 0, skipped: 0, failed: 0, errors: [] });
      });

      pluginRegistry.get.mockReturnValue({
        start: pluginStart,
        stop: pluginStop,
        getStatus: vi.fn(),
        detect: vi.fn(),
      });

      const runtime = lifecycle.register('srv-1', config, queue as never);
      runtime.forceState('running', { pid: 321 });
      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      const running = executor({ kind: 'LifecycleRestart', meta: { mode: 'run' } });

      await vi.waitFor(() => {
        expect(hookRunner.runHooks).toHaveBeenCalledWith(expect.objectContaining({
          phase: 'pre',
          event: 'lifecycle.restart',
        }));
      });

      lifecycle.cancel('srv-1');
      releaseRestartPreHook?.();
      await expect(running).rejects.toMatchObject({ code: ErrorCode.Cancelled });

      expect(queue.clear).toHaveBeenCalledOnce();
      expect(pluginStop).not.toHaveBeenCalled();
      expect(pluginStart).not.toHaveBeenCalled();
      expect(runtime.state).toBe('running');
      expect(hookRunner.runHooks).toHaveBeenCalledTimes(1);
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleRestart',
        error: expect.objectContaining({ code: ErrorCode.Cancelled }),
      }));
    });

    it('runs only lifecycle.restart onError hooks when internal start fails during restart', async () => {
      const queue = mockQueue();
      const config = {
        ...makeServer(),
        hooks: [
          makeHook('lifecycle.restart'),
          { ...makeHook('lifecycle.restart'), id: 'hook-restart-on-error', phase: 'onError' },
          { ...makeHook('lifecycle.start'), id: 'hook-start-on-error', phase: 'onError' },
          { ...makeHook('lifecycle.stop'), id: 'hook-stop-on-error', phase: 'onError' },
        ],
      };
      const startError = new JsmError({
        code: ErrorCode.ProcessSpawnFailed,
        message: 'restart start failed',
      });
      const pluginStart = vi.fn(async () => err(startError));
      const pluginStop = vi.fn(async () => ok(undefined));

      pluginRegistry.get.mockReturnValue({
        start: pluginStart,
        stop: pluginStop,
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      pidManager.isProcessAlive.mockReturnValue(false);

      const runtime = lifecycle.register('srv-1', config, queue as never);
      runtime.forceState('running', { pid: 321 });
      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;

      await expect(executor({ kind: 'LifecycleRestart', meta: { mode: 'run' } })).rejects.toBe(startError);

      expect(runtime.state).toBe('error');
      expect(pluginStop).toHaveBeenCalledOnce();
      expect(pluginStart).toHaveBeenCalledOnce();
      expect(hookRunner.runHooks).toHaveBeenCalledTimes(2);
      expect(hookRunner.runHooks.mock.calls.map(([call]) => `${call.phase}:${call.event}`)).toEqual([
        'pre:lifecycle.restart',
        'onError:lifecycle.restart',
      ]);
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleRestart',
        error: startError,
      }));
    });

    it('completes stop after the process exits gracefully', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(async () => ok(undefined)),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      pidManager.isProcessAlive.mockReturnValue(false);

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await executor({ kind: 'LifecycleStop' });

      expect(pidManager.isProcessAlive).toHaveBeenCalledWith(123);
      expect(pidManager.clearPid).toHaveBeenCalledWith('srv-1');
      expect(debugAttacher.detach).toHaveBeenCalledWith('srv-1');
      expect(runtime.state).toBe('stopped');
      expect(bus.emit).toHaveBeenCalledWith('OperationCompleted', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleStop',
      }));
    });

    it('force-kills the process when stop escalation reaches the kill threshold', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', {
        ...makeServer(),
        timeouts: { stopMs: 20 },
      } as ServerConfig, queue as never);
      runtime.forceState('running', { pid: 123 });

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(async () => ok(undefined)),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      pidManager.isProcessAlive
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      const nowValues = [0, 0, 0, 0, 0, 25, 25];
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowValues.shift() ?? 25);
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      try {
        const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
        await executor({ kind: 'LifecycleStop' });

        if (process.platform === 'win32') {
          expect(spawnSyncMock).toHaveBeenCalledWith('taskkill', ['/F', '/T', '/PID', '123'], {
            shell: false,
            stdio: 'ignore',
            windowsHide: true,
          });
          expect(killSpy).not.toHaveBeenCalled();
        } else {
          expect(spawnSyncMock).not.toHaveBeenCalled();
          expect(killSpy).toHaveBeenCalledWith(123, 'SIGKILL');
        }
      } finally {
        dateNowSpy.mockRestore();
        killSpy.mockRestore();
      }

      expect(logger.warn).toHaveBeenCalledWith('ServerLifecycle: force-killing My Tomcat (PID 123)');
      expect(pidManager.clearPid).toHaveBeenCalledWith('srv-1');
      expect(runtime.state).toBe('stopped');
    });

    it('force-kills a still-running process when the timeout has already elapsed before the wait loop continues', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', {
        ...makeServer(),
        timeouts: { stopMs: 20 },
      } as ServerConfig, queue as never);
      runtime.forceState('running', { pid: 123 });

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(async () => ok(undefined)),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      pidManager.isProcessAlive
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      const nowValues = [0, 0, 0, 25];
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowValues.shift() ?? 25);
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      try {
        const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
        await executor({ kind: 'LifecycleStop' });

        if (process.platform === 'win32') {
          expect(spawnSyncMock).toHaveBeenCalledWith('taskkill', ['/F', '/T', '/PID', '123'], {
            shell: false,
            stdio: 'ignore',
            windowsHide: true,
          });
          expect(killSpy).not.toHaveBeenCalled();
        } else {
          expect(spawnSyncMock).not.toHaveBeenCalled();
          expect(killSpy).toHaveBeenCalledWith(123, 'SIGKILL');
        }
      } finally {
        dateNowSpy.mockRestore();
        killSpy.mockRestore();
      }

      expect(logger.warn).toHaveBeenCalledWith('ServerLifecycle: force-killing My Tomcat (PID 123)');
      expect(runtime.state).toBe('stopped');
    });

    it('cancels an active stop operation while waiting for shutdown', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(async () => ok(undefined)),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      pidManager.isProcessAlive.mockReturnValue(true);

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      const running = executor({ kind: 'LifecycleStop' });

      await vi.waitFor(() => {
        expect(runtime.state).toBe('stopping');
      });

      lifecycle.cancel('srv-1');
      await expect(running).rejects.toMatchObject({ code: ErrorCode.Cancelled });

      expect(queue.clear).toHaveBeenCalledOnce();
      expect(pidManager.clearPid).not.toHaveBeenCalled();
      expect(debugAttacher.detach).not.toHaveBeenCalled();
      expect(runtime.state).toBe('error');
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleStop',
        error: expect.objectContaining({ code: ErrorCode.Cancelled }),
      }));
    });

    it('keeps plugin.stop errors warning-only and still finalizes stop', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });
      runtime.setDebugAttached(true);
      const stopError = new JsmError({
        code: ErrorCode.ProcessSpawnFailed,
        message: 'stop failed',
      });

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(async () => err(stopError)),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      pidManager.isProcessAlive.mockReturnValue(false);

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await executor({ kind: 'LifecycleStop' });

      expect(logger.warn).toHaveBeenCalledWith(`ServerLifecycle: stop error for 'My Tomcat'`, stopError);
      expect(pidManager.clearPid).toHaveBeenCalledWith('srv-1');
      expect(debugAttacher.detach).toHaveBeenCalledWith('srv-1');
      expect(runtime.state).toBe('stopped');
      expect(runtime.debugAttached).toBe(false);
      expect(bus.emit).toHaveBeenCalledWith('OperationCompleted', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'LifecycleStop',
      }));
    });

    it('clears pid and detaches debug before the stopped transition', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });
      runtime.setDebugAttached(true);

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(async () => ok(undefined)),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      pidManager.isProcessAlive.mockReturnValue(false);

      const transitionSpy = vi.spyOn(runtime, 'transition');

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await executor({ kind: 'LifecycleStop' });

      const stoppedTransitionIndex = transitionSpy.mock.calls.findIndex(([state]) => state === 'stopped');
      expect(stoppedTransitionIndex).toBeGreaterThanOrEqual(0);
      expect(pidManager.clearPid.mock.invocationCallOrder[0]).toBeLessThan(debugAttacher.detach.mock.invocationCallOrder[0]);
      expect(debugAttacher.detach.mock.invocationCallOrder[0]).toBeLessThan(
        transitionSpy.mock.invocationCallOrder[stoppedTransitionIndex],
      );
    });

    it('records executor failures as queue drain failures while still emitting OperationFailed once', async () => {
      const queue = new OperationQueue('srv-1', mockLogger());
      const startError = new JsmError({
        code: ErrorCode.ProcessSpawnFailed,
        message: 'queue start failed',
      });

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(async () => err(startError)),
        stop: vi.fn(),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });

      lifecycle.register('srv-1', makeServer(), queue as never);

      const startedBefore = bus.emit.mock.calls.filter(([event]) => event === 'OperationStarted').length;
      const failedBefore = bus.emit.mock.calls.filter(([event]) => event === 'OperationFailed').length;
      const completedBefore = bus.emit.mock.calls.filter(([event]) => event === 'OperationCompleted').length;

      const queued = lifecycle.start('srv-1', 'run');
      expect(queued.ok).toBe(true);

      await lifecycle.waitUntilQueueIdle('srv-1');

      expect(lifecycle.getAndClearQueueDrainFailure('srv-1')).toBe(startError);
      expect(lifecycle.getAndClearQueueDrainFailure('srv-1')).toBeUndefined();

      const startedAfter = bus.emit.mock.calls.filter(([event]) => event === 'OperationStarted').length;
      const failedAfter = bus.emit.mock.calls.filter(([event]) => event === 'OperationFailed').length;
      const completedAfter = bus.emit.mock.calls.filter(([event]) => event === 'OperationCompleted').length;

      expect(startedAfter - startedBefore).toBe(1);
      expect(failedAfter - failedBefore).toBe(1);
      expect(completedAfter - completedBefore).toBe(0);
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

  describe('deploy enqueue', () => {
    it('enqueues DeploySync with fileChangeBatch metadata', () => {
      const queue = mockQueue();
      const batch = {
        changes: [{ path: 'index.jsp', type: 'changed' as const }],
        totalBytes: 12,
      };

      lifecycle.register('srv-1', makeServer(), queue as never);
      const result = lifecycle.enqueueDeploySync('srv-1', 'dep-1', batch);

      expect(result.ok).toBe(true);
      expect(queue.enqueue).toHaveBeenCalledWith({
        kind: 'DeploySync',
        targetDeploymentId: 'dep-1',
        meta: { fileChangeBatch: batch },
      });
    });

    it('rejects deploy enqueue for unknown server through the shared enqueue seam', () => {
      const result = lifecycle.enqueueRedeployAll('nope');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.InvalidConfig);
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

    it('clears pending queue work before removing the server', () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);

      lifecycle.unregister('srv-1');

      expect(queue.clear).toHaveBeenCalledOnce();
      expect(lifecycle.getRuntime('srv-1')).toBeUndefined();
    });

    it('is a no-op for an unknown server key', () => {
      expect(() => lifecycle.unregister('missing')).not.toThrow();
    });

    it('cancels an active start during unregister without invoking plugin stop cleanup', async () => {
      const queue = mockQueue();
      const start = vi.fn(async () => ok({
        pid: 123,
        httpUrl: 'http://127.0.0.1:8080',
        hints: [],
      }));
      const stop = vi.fn(async () => ok(undefined));

      pluginRegistry.get.mockReturnValue({
        start,
        stop,
        getStatus: vi.fn(),
        detect: vi.fn(),
      });
      pidManager.writePid.mockImplementation(async () => {
        lifecycle.unregister('srv-1');
      });

      lifecycle.register('srv-1', makeServer(), queue as never);
      const executor = queue.setExecutor.mock.calls[0][0] as (entry: {
        kind: string;
        meta?: Record<string, unknown>;
      }) => Promise<void>;

      await expect(executor({
        kind: 'LifecycleStart',
        meta: { mode: 'run' },
      })).rejects.toMatchObject({
        code: ErrorCode.Cancelled,
      });

      expect(queue.clear).toHaveBeenCalledOnce();
      expect(stop).not.toHaveBeenCalled();
      expect(lifecycle.getRuntime('srv-1')).toBeUndefined();
    });
  });

  describe('deploy queue execution', () => {
    function makeDeploymentConfig(depId = 'dep-1') {
      return {
        id: depId,
        type: 'exploded' as const,
        sourcePath: '/src/app',
        deployName: 'myapp',
        syncMode: 'auto' as const,
        ignoreGlobs: [],
        hooks: [],
      };
    }

    function registerWithDeployment(depId = 'dep-1') {
      const queue = mockQueue();
      const config = {
        ...makeServer(),
        deployments: [makeDeploymentConfig(depId)],
      };
      lifecycle.register('srv-1', config, queue as never);
      const executor = queue.setExecutor.mock.calls[0][0] as (entry: {
        kind: string;
        targetDeploymentId?: string;
        meta?: Record<string, unknown>;
      }) => Promise<void>;
      return { config, executor };
    }

    it('dispatches DeployFull with resolved deployment context', async () => {
      const { config, executor } = registerWithDeployment();

      await executor({ kind: 'DeployFull', targetDeploymentId: 'dep-1' });

      expect(deployService.fullRedeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'srv-1',
          kind: 'DeployFull',
          targetDeploymentId: 'dep-1',
        }),
        config,
        config.deployments[0],
      );
      expect(bus.emit).toHaveBeenCalledWith('OperationCompleted', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'DeployFull',
      }));
    });

    it('fails DeployFull when targetDeploymentId is missing', async () => {
      const { executor } = registerWithDeployment();

      await expect(executor({ kind: 'DeployFull' })).rejects.toMatchObject({
        code: ErrorCode.InvalidConfig,
        message: 'DeployFull requires targetDeploymentId',
      });

      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'DeployFull',
        error: expect.objectContaining({
          code: ErrorCode.InvalidConfig,
          message: 'DeployFull requires targetDeploymentId',
        }),
      }));
      expect(deployService.fullRedeploy).not.toHaveBeenCalled();
    });

    it('dispatches DeployRollback with resolved deployment context', async () => {
      const { config, executor } = registerWithDeployment();

      await executor({ kind: 'DeployRollback', targetDeploymentId: 'dep-1' });

      expect(deployService.rollback).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'srv-1',
          kind: 'DeployRollback',
          targetDeploymentId: 'dep-1',
        }),
        config,
        config.deployments[0],
      );
      expect(bus.emit).toHaveBeenCalledWith('OperationCompleted', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'DeployRollback',
      }));
    });

    it('dispatches Undeploy with resolved deployment context', async () => {
      const { config, executor } = registerWithDeployment();

      await executor({ kind: 'Undeploy', targetDeploymentId: 'dep-1' });

      expect(deployService.undeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'srv-1',
          kind: 'Undeploy',
          targetDeploymentId: 'dep-1',
        }),
        config,
        config.deployments[0],
      );
    });

    it('dispatches RedeployAll through DeploymentService', async () => {
      const { config, executor } = registerWithDeployment();

      await executor({ kind: 'RedeployAll' });

      expect(deployService.redeployAll).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'srv-1',
          kind: 'RedeployAll',
        }),
        config,
      );
    });

    it('dispatches DeployUndeployed through DeploymentService', async () => {
      const { config, executor } = registerWithDeployment();

      await executor({ kind: 'DeployUndeployed' });

      expect(deployService.deployUndeployed).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'srv-1',
          kind: 'DeployUndeployed',
        }),
        config,
      );
    });

    it('uses resolveServerConfig for DeploySync', async () => {
      const queue = mockQueue();
      const registeredConfig = {
        ...makeServer(),
        deployments: [makeDeploymentConfig()],
      };
      const refreshedConfig = {
        ...registeredConfig,
        deployments: [{
          ...registeredConfig.deployments[0],
          deployName: 'fresh-name',
          sourcePath: '/src/fresh',
        }],
      };

      lifecycle = new ServerLifecycle({
        pluginRegistry: pluginRegistry as never,
        bus: bus as never,
        pidManager: pidManager as never,
        portScanner: portScanner as never,
        debugAttacher: debugAttacher as never,
        logger: mockLogger(),
        hookRunner: hookRunner as never,
        deployService: deployService as never,
        resolveServerConfig: vi.fn(() => refreshedConfig),
      });

      lifecycle.register('srv-1', registeredConfig, queue as never);
      const executor = queue.setExecutor.mock.calls[0][0] as (entry: {
        kind: string;
        targetDeploymentId?: string;
        meta?: Record<string, unknown>;
      }) => Promise<void>;

      await executor({
        kind: 'DeploySync',
        targetDeploymentId: 'dep-1',
        meta: {
          fileChangeBatch: {
            changes: [{ path: 'index.jsp', type: 'changed' }],
            totalBytes: 12,
          },
        },
      });

      expect(deployService.sync).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'srv-1',
          kind: 'DeploySync',
          targetDeploymentId: 'dep-1',
        }),
        refreshedConfig,
        refreshedConfig.deployments[0],
        expect.objectContaining({
          changes: [{ path: 'index.jsp', type: 'changed' }],
          totalBytes: 12,
        }),
      );
    });

    it('records DeploySync failure when sync returns an error result', async () => {
      const onDeploySyncFailure = vi.fn();
      const appendLine = vi.fn();
      const queue = mockQueue();
      const config = {
        ...makeServer(),
        deployments: [makeDeploymentConfig()],
      };
      const syncError = new JsmError({ code: ErrorCode.DeployFailed, message: 'sync failed' });

      deployService.sync.mockResolvedValue(
        err(syncError),
      );

      lifecycle = new ServerLifecycle({
        pluginRegistry: pluginRegistry as never,
        bus: bus as never,
        pidManager: pidManager as never,
        portScanner: portScanner as never,
        debugAttacher: debugAttacher as never,
        logger: mockLogger(),
        hookRunner: hookRunner as never,
        deployService: deployService as never,
        getOutputSink: () => ({ append: vi.fn(), appendLine, clear: vi.fn() }),
        onDeploySyncFailure,
      });

      lifecycle.register('srv-1', config, queue as never);
      const executor = queue.setExecutor.mock.calls[0][0] as (entry: {
        kind: string;
        targetDeploymentId?: string;
        meta?: Record<string, unknown>;
      }) => Promise<void>;

      await expect(executor({
        kind: 'DeploySync',
        targetDeploymentId: 'dep-1',
        meta: {
          fileChangeBatch: {
            changes: [{ path: 'index.jsp', type: 'changed' }],
            totalBytes: 12,
          },
        },
      })).rejects.toBe(syncError);

      expect(onDeploySyncFailure).toHaveBeenCalledWith('srv-1', 'dep-1');
      expect(appendLine).toHaveBeenCalledWith("Deploy sync failed for 'myapp': sync failed");
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'DeploySync',
        error: syncError,
      }));
    });

    it('records DeploySync failure and emits OperationFailed when sync throws', async () => {
      const onDeploySyncFailure = vi.fn();
      const appendLine = vi.fn();
      const queue = mockQueue();
      const config = {
        ...makeServer(),
        deployments: [makeDeploymentConfig()],
      };

      deployService.sync.mockRejectedValue(new Error('sync crash'));

      lifecycle = new ServerLifecycle({
        pluginRegistry: pluginRegistry as never,
        bus: bus as never,
        pidManager: pidManager as never,
        portScanner: portScanner as never,
        debugAttacher: debugAttacher as never,
        logger: mockLogger(),
        hookRunner: hookRunner as never,
        deployService: deployService as never,
        getOutputSink: () => ({ append: vi.fn(), appendLine, clear: vi.fn() }),
        onDeploySyncFailure,
      });

      lifecycle.register('srv-1', config, queue as never);
      const executor = queue.setExecutor.mock.calls[0][0] as (entry: {
        kind: string;
        targetDeploymentId?: string;
        meta?: Record<string, unknown>;
      }) => Promise<void>;

      await expect(executor({
        kind: 'DeploySync',
        targetDeploymentId: 'dep-1',
        meta: {
          fileChangeBatch: {
            changes: [{ path: 'index.jsp', type: 'changed' }],
            totalBytes: 12,
          },
        },
      })).rejects.toMatchObject({
        message: 'sync crash',
      });

      expect(onDeploySyncFailure).toHaveBeenCalledWith('srv-1', 'dep-1');
      expect(appendLine).toHaveBeenCalledWith("Deploy sync failed for 'myapp': sync crash");
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'DeploySync',
        error: expect.objectContaining({
          message: 'sync crash',
        }),
      }));
    });

    it('fails DeploySync when targetDeploymentId is missing', async () => {
      const { executor } = registerWithDeployment();

      await expect(executor({
        kind: 'DeploySync',
        meta: {
          fileChangeBatch: {
            changes: [{ path: 'index.jsp', type: 'changed' }],
            totalBytes: 12,
          },
        },
      })).rejects.toMatchObject({
        code: ErrorCode.InvalidConfig,
        message: 'DeploySync requires targetDeploymentId',
      });

      expect(deployService.sync).not.toHaveBeenCalled();
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'DeploySync',
        error: expect.objectContaining({
          code: ErrorCode.InvalidConfig,
          message: 'DeploySync requires targetDeploymentId',
        }),
      }));
    });

    it('fails DeploySync when fileChangeBatch metadata is missing', async () => {
      const appendLine = vi.fn();
      lifecycle = new ServerLifecycle({
        pluginRegistry: pluginRegistry as never,
        bus: bus as never,
        pidManager: pidManager as never,
        portScanner: portScanner as never,
        debugAttacher: debugAttacher as never,
        logger: mockLogger(),
        hookRunner: hookRunner as never,
        deployService: deployService as never,
        getOutputSink: () => ({ append: vi.fn(), appendLine, clear: vi.fn() }),
      });
      const { executor } = registerWithDeployment();

      await expect(executor({
        kind: 'DeploySync',
        targetDeploymentId: 'dep-1',
      })).rejects.toMatchObject({
        code: ErrorCode.InvalidConfig,
        message: 'DeploySync requires fileChangeBatch metadata',
      });

      expect(deployService.sync).not.toHaveBeenCalled();
      expect(appendLine).not.toHaveBeenCalled();
      expect(bus.emit).toHaveBeenCalledWith('OperationFailed', expect.objectContaining({
        serverId: 'srv-1',
        kind: 'DeploySync',
        error: expect.objectContaining({
          code: ErrorCode.InvalidConfig,
          message: 'DeploySync requires fileChangeBatch metadata',
        }),
      }));
    });

    it('records queue drain failure when DeploySync returns an error result', async () => {
      const onDeploySyncFailure = vi.fn();
      const queue = new OperationQueue('srv-1', mockLogger());
      const config = {
        ...makeServer(),
        deployments: [makeDeploymentConfig()],
      };
      const syncError = new JsmError({ code: ErrorCode.DeployFailed, message: 'sync failed' });

      deployService.sync.mockResolvedValue(err(syncError));

      lifecycle = new ServerLifecycle({
        pluginRegistry: pluginRegistry as never,
        bus: bus as never,
        pidManager: pidManager as never,
        portScanner: portScanner as never,
        debugAttacher: debugAttacher as never,
        logger: mockLogger(),
        hookRunner: hookRunner as never,
        deployService: deployService as never,
        onDeploySyncFailure,
      });

      lifecycle.register('srv-1', config, queue as never);

      const enqueued = lifecycle.enqueueDeploySync('srv-1', 'dep-1', {
        changes: [{ path: 'index.jsp', type: 'changed' }],
        totalFiles: 1,
        totalBytes: 12,
      });
      expect(enqueued.ok).toBe(true);

      await lifecycle.waitUntilQueueIdle('srv-1');

      expect(onDeploySyncFailure).toHaveBeenCalledOnce();
      expect(lifecycle.getAndClearQueueDrainFailure('srv-1')).toBe(syncError);
      expect(lifecycle.getAndClearQueueDrainFailure('srv-1')).toBeUndefined();
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

      pidManager.readPidRecord.mockResolvedValue({
        pid: 42,
        serverKey: 'srv-1',
        instancePath: '/tmp/inst',
        runtimeHomePath: '/opt/tomcat',
        writtenAt: Date.now(),
        processStartToken: 'token',
      });
      pidManager.isProcessAlive.mockReturnValue(true);
      pidManager.isPidRecordCurrent.mockReturnValue(true);

      await lifecycle.reconcileRunningServers([{ serverKey: 'srv-1', config: makeServer() }]);

      expect(runtime.state).toBe('running');
    });

    it('clears legacy numeric PID files instead of trusting PID reuse', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);

      pidManager.readPidRecord.mockResolvedValue(undefined);
      pidManager.readPid.mockResolvedValue(42);
      pidManager.isProcessAlive.mockReturnValue(true);

      await lifecycle.reconcileRunningServers([{ serverKey: 'srv-1', config: makeServer() }]);

      expect(runtime.state).toBe('stopped');
      expect(pidManager.clearPid).toHaveBeenCalledWith('srv-1');
    });

    it('clears PID records whose identity no longer matches the managed server', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);

      pidManager.readPidRecord.mockResolvedValue({
        pid: 42,
        serverKey: 'srv-1',
        instancePath: '/other/instance',
        runtimeHomePath: '/opt/tomcat',
        writtenAt: Date.now(),
        processStartToken: 'token',
      });
      pidManager.isProcessAlive.mockReturnValue(true);
      pidManager.isPidRecordCurrent.mockReturnValue(true);

      await lifecycle.reconcileRunningServers([{ serverKey: 'srv-1', config: makeServer() }]);

      expect(runtime.state).toBe('stopped');
      expect(pidManager.clearPid).toHaveBeenCalledWith('srv-1');
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

    it('forces stopped state when reconciliation throws', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);

      pidManager.readPid.mockRejectedValue(new Error('read failed'));

      await lifecycle.reconcileRunningServers([{ serverKey: 'srv-1', config: makeServer() }]);

      expect(runtime.state).toBe('stopped');
      expect(bus.emit).toHaveBeenCalledWith('WorkspaceLoaded', { serverCount: 1 });
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
        deployService: mockDeployService() as never,
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

    it('blocks trusted deploy enqueue paths in untrusted workspace', () => {
      const queue = mockQueue();
      untrustedLifecycle.register('srv-1', makeServer(), queue as never);
      const result = untrustedLifecycle.enqueueRedeployAll('srv-1');
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
        deployService: mockDeployService() as never,
      });
      const queue = mockQueue();
      trustedLifecycle.register('srv-1', makeServer(), queue as never);
      const result = trustedLifecycle.start('srv-1', 'run');
      expect(result.ok).toBe(true);
    });
  });

  /* ── attachDebug / detachDebug ───────────────────────────────────── */

  describe('attachDebug', () => {
    it('attaches debugger to running server', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });

      debugAttacher.attach.mockResolvedValue(ok(undefined));

      const result = await lifecycle.attachDebug('srv-1');
      expect(result.ok).toBe(true);
      expect(debugAttacher.attach).toHaveBeenCalledWith({
        serverId: 'srv-1',
        port: 5005,
        name: 'Debug: My Tomcat',
        bind: '127.0.0.1',
      });
      expect(runtime.debugAttached).toBe(true);
    });

    it('fails when server is stopped', async () => {
      const queue = mockQueue();
      lifecycle.register('srv-1', makeServer(), queue as never);

      const result = await lifecycle.attachDebug('srv-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.NotRunning);
    });

    it('fails when already attached', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });
      runtime.setDebugAttached(true);

      const result = await lifecycle.attachDebug('srv-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.AlreadyRunning);
    });

    it('fails for unknown server', async () => {
      const result = await lifecycle.attachDebug('nope');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.InvalidConfig);
    });

    it('does not set debugAttached when attach fails', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });

      debugAttacher.attach.mockResolvedValue(
        err(new JsmError({ code: ErrorCode.ProcessSpawnFailed, message: 'attach failed' })),
      );

      const result = await lifecycle.attachDebug('srv-1');
      expect(result.ok).toBe(false);
      expect(runtime.debugAttached).toBe(false);
    });
  });

  describe('detachDebug', () => {
    it('detaches debugger from server with attached debugger', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });
      runtime.setDebugAttached(true);

      const result = await lifecycle.detachDebug('srv-1');
      expect(result.ok).toBe(true);
      expect(debugAttacher.detach).toHaveBeenCalledWith('srv-1');
      expect(runtime.debugAttached).toBe(false);
    });

    it('fails when debugger not attached', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });

      const result = await lifecycle.detachDebug('srv-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.InvalidConfig);
    });

    it('fails for unknown server', async () => {
      const result = await lifecycle.detachDebug('nope');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.InvalidConfig);
    });
  });

  describe('debug state tracking', () => {
    it('sets debugAttached true after start in debug mode', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);

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
      debugAttacher.attach.mockResolvedValue(ok(undefined));

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await executor({ kind: 'LifecycleStart', meta: { mode: 'debug' } });

      expect(runtime.state).toBe('running');
      expect(debugAttacher.attach).toHaveBeenCalled();
      expect(runtime.debugAttached).toBe(true);
    });

    it('does not set debugAttached after start in run mode', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);

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

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await executor({ kind: 'LifecycleStart', meta: { mode: 'run' } });

      expect(runtime.state).toBe('running');
      expect(debugAttacher.attach).not.toHaveBeenCalled();
      expect(runtime.debugAttached).toBe(false);
    });

    it('clears debugAttached on stop', async () => {
      const queue = mockQueue();
      const runtime = lifecycle.register('srv-1', makeServer(), queue as never);
      runtime.forceState('running', { pid: 123 });
      runtime.setDebugAttached(true);

      pluginRegistry.get.mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(async () => ok(undefined)),
        getStatus: vi.fn(),
        detect: vi.fn(),
      });

      const executor = queue.setExecutor.mock.calls[0][0] as (entry: { kind: string; meta?: Record<string, unknown> }) => Promise<void>;
      await executor({ kind: 'LifecycleStop' });

      expect(runtime.state).toBe('stopped');
      expect(runtime.debugAttached).toBe(false);
    });
  });
});

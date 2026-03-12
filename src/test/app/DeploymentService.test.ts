import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeploymentService } from '@app/deployment/DeploymentService';
import { EventBus } from '@core/events/EventBus';
import type { Logger } from '@core/types/logger';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { IServerPlugin } from '@plugins/interfaces/IServerPlugin';
import type { ServerConfig, DeploymentConfig, HookConfig } from '@core/types/domain';
import type { EventMap } from '@core/types/events';
import type { OperationContext } from '@core/types';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(): ServerConfig {
  return {
    id: 's1',
    name: 'Test Server',
    type: 'tomcat',
    runtime: { id: 'rt1', homePath: '/opt/tomcat', version: '10.1' },
    instancePath: '/tmp/inst',
    javaHome: '/opt/java',
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

function makeDep(id = 'd1'): DeploymentConfig {
  return {
    id,
    type: 'war',
    sourcePath: '/src/app.war',
    deployName: 'app',
    syncMode: 'manual',
    ignoreGlobs: [],
    hooks: [],
  };
}

function makeDepWithHealthPath(id = 'd1', healthCheckPath = '/app/health'): DeploymentConfig {
  return { ...makeDep(id), healthCheckPath };
}

function makeHook(event: HookConfig['event'], phase: HookConfig['phase'] = 'pre', id = `${event}-${phase}`): HookConfig {
  return {
    id,
    enabled: true,
    phase,
    event,
    kind: 'command',
    timeoutMs: 60_000,
    continueOnError: false,
    command: { mode: 'shell', line: 'echo ok' },
  };
}

function makeCtx(serverId = 's1', deploymentId = 'd1', kind: OperationContext['kind'] = 'DeployFull'): OperationContext {
  return {
    operationId: 'op-1',
    serverId,
    kind,
    targetDeploymentId: deploymentId,
    startedAt: Date.now(),
    timeoutMs: 60_000,
    cancel: { isCancelled: false, onCancelled: () => ({ dispose: () => {} }) },
    progress: { report: () => {} },
    output: { append: () => {}, appendLine: () => {}, clear: () => {} },
  };
}

describe('DeploymentService', () => {
  let bus: EventBus;
  let service: DeploymentService;
  let mockPlugin: IServerPlugin;
  let mockRegistry: PluginRegistry;
  let hookRunner: { runHooks: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    bus = new EventBus(mockLogger());

    mockPlugin = {
      type: 'tomcat',
      displayName: 'Tomcat',
      getCapabilities: vi.fn(),
      detectInstallation: vi.fn(),
      validateConfig: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      planDeploy: vi.fn().mockResolvedValue(ok({
        targetRoot: '/tmp/inst/webapps',
        targetPath: '/tmp/inst/webapps/app',
        strategy: 'copy-war',
        notes: [],
      })),
      deployFull: vi.fn().mockResolvedValue(ok({
        strategy: 'copy-war',
        deployedPath: '/tmp/inst/webapps/app.war',
        warnings: [],
      })),
      undeploy: vi.fn().mockResolvedValue(ok(undefined)),
      getStatus: vi.fn(),
      getLogSources: vi.fn(),
      getDefaultConfig: vi.fn(),
    } as unknown as IServerPlugin;

    mockRegistry = {
      get: vi.fn().mockReturnValue(mockPlugin),
    } as unknown as PluginRegistry;

    hookRunner = {
      runHooks: vi.fn(async () => ok({ executed: 0, skipped: 0, failed: 0, errors: [] })),
    };

    service = new DeploymentService({
      pluginRegistry: mockRegistry,
      bus,
      logger: mockLogger(),
      hookRunner: hookRunner as never,
    });
  });

  it('starts in undeployed state', () => {
    expect(service.getDeploymentState('s1', 'd1')).toBe('undeployed');
  });

  it('fullRedeploy transitions to synced on success', async () => {
    const config = makeConfig();
    const dep = makeDep();

    const events: unknown[] = [];
    bus.on('DeploymentStateChanged', (e: EventMap['DeploymentStateChanged']) => events.push(e));

    const result = await service.fullRedeploy(makeCtx(), config, dep);
    expect(result.ok).toBe(true);
    expect(service.getDeploymentState('s1', 'd1')).toBe('synced');
    // deploying → synced
    expect(events).toHaveLength(2);
  });

  it('runs merged deploy.full hooks from server and deployment config', async () => {
    const config = {
      ...makeConfig(),
      hooks: [makeHook('deploy.full', 'pre', 'server-pre')],
    };
    const dep = {
      ...makeDep(),
      hooks: [makeHook('deploy.full', 'post', 'dep-post')],
    };

    const result = await service.fullRedeploy(makeCtx(), config, dep);

    expect(result.ok).toBe(true);
    expect(hookRunner.runHooks).toHaveBeenNthCalledWith(
      1,
      's1',
      'pre',
      'deploy.full',
      [...config.hooks, ...dep.hooks],
    );
    expect(hookRunner.runHooks).toHaveBeenNthCalledWith(
      2,
      's1',
      'post',
      'deploy.full',
      [...config.hooks, ...dep.hooks],
    );
  });

  it('fullRedeploy transitions to error on plan failure', async () => {
    (mockPlugin.planDeploy as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new JsmError({ code: ErrorCode.DeployFailed, message: 'plan failed' })),
    );

    const result = await service.fullRedeploy(makeCtx(), makeConfig(), makeDep());
    expect(result.ok).toBe(false);
    expect(service.getDeploymentState('s1', 'd1')).toBe('error');
  });

  it('undeploy transitions from synced to undeployed', async () => {
    const config = makeConfig();
    const dep = makeDep();

    // First deploy
    await service.fullRedeploy(makeCtx(), config, dep);
    expect(service.getDeploymentState('s1', 'd1')).toBe('synced');

    // Then undeploy
    const result = await service.undeploy(makeCtx('s1', 'd1', 'Undeploy'), config, dep);
    expect(result.ok).toBe(true);
    expect(service.getDeploymentState('s1', 'd1')).toBe('undeployed');
  });

  it('undeploy from undeployed is a no-op success', async () => {
    const result = await service.undeploy(makeCtx('s1', 'd1', 'Undeploy'), makeConfig(), makeDep());
    expect(result.ok).toBe(true);
    expect(mockPlugin.undeploy).not.toHaveBeenCalled();
  });

  it('sync falls back to fullRedeploy when plugin lacks deployIncremental', async () => {
    const config = makeConfig();
    const dep = makeDep();
    const batch = { changes: [], totalFiles: 0, totalBytes: 0 };

    await service.sync(makeCtx('s1', 'd1', 'DeployIncremental'), config, dep, batch);
    expect(mockPlugin.planDeploy).toHaveBeenCalled();
    expect(mockPlugin.deployFull).toHaveBeenCalled();
  });

  it('sync falls back to fullRedeploy for risky exploded changes', async () => {
    const config = makeConfig();
    const dep = { ...makeDep(), type: 'exploded', sourcePath: '/src/app' };
    const batch = {
      changes: [{ type: 'change', path: '/src/app/WEB-INF/classes/App.class', relativePath: 'WEB-INF/classes/App.class' }],
      totalFiles: 1,
      totalBytes: 100,
    };

    mockPlugin.deployIncremental = vi.fn().mockResolvedValue(ok(undefined));

    await service.sync(makeCtx('s1', 'd1', 'DeployIncremental'), config, dep, batch);
    expect(mockPlugin.deployFull).toHaveBeenCalled();
    expect(mockPlugin.deployIncremental).not.toHaveBeenCalled();
  });

  it('throws on unsupported server type', async () => {
    (mockRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const config = { ...makeConfig(), type: 'unknown' as never };

    await expect(
      service.fullRedeploy(makeCtx(), config, makeDep()),
    ).rejects.toThrow();
  });

  describe('TrustGate (§12.8)', () => {
    let untrustedService: DeploymentService;

    beforeEach(() => {
      untrustedService = new DeploymentService({
        pluginRegistry: mockRegistry,
        bus,
        logger: mockLogger(),
        trustGate: { isTrusted: () => false },
      });
    });

    it('blocks fullRedeploy in untrusted workspace', async () => {
      const result = await untrustedService.fullRedeploy(makeCtx(), makeConfig(), makeDep());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    });

    it('blocks sync in untrusted workspace', async () => {
      const batch = { changes: [], totalFiles: 0, totalBytes: 0 };
      const result = await untrustedService.sync(makeCtx('s1', 'd1', 'DeployIncremental'), makeConfig(), makeDep(), batch);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    });

    it('blocks undeploy in untrusted workspace', async () => {
      // First deploy in a trusted service, then try to undeploy in untrusted
      await service.fullRedeploy(makeCtx(), makeConfig(), makeDep());
      const result = await untrustedService.undeploy(makeCtx('s1', 'd1', 'Undeploy'), makeConfig(), makeDep());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    });
  });

  describe('deployment health check', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('getDeploymentHealth returns undefined when no check run yet', () => {
      expect(service.getDeploymentHealth('s1', 'd1')).toBeUndefined();
    });

    it('runHealthChecksForServer runs GET for synced deployments with healthCheckPath and stores result', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });
      const config = { ...makeConfig(), deployments: [makeDepWithHealthPath()] };
      await service.fullRedeploy(makeCtx(), config, config.deployments[0]);
      expect(service.getDeploymentState('s1', 'd1')).toBe('synced');

      await service.runHealthChecksForServer('s1', config);

      const health = service.getDeploymentHealth('s1', 'd1');
      expect(health).toBeDefined();
      expect(health!.ok).toBe(true);
      expect(typeof health!.latencyMs).toBe('number');
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8080/app/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('runHealthChecksForServer skips deployments without healthCheckPath', async () => {
      const config = makeConfig();
      config.deployments = [makeDep()];
      await service.fullRedeploy(makeCtx(), config, config.deployments[0]);
      await service.runHealthChecksForServer('s1', config);
      expect(fetch).not.toHaveBeenCalled();
      expect(service.getDeploymentHealth('s1', 'd1')).toBeUndefined();
    });

    it('runHealthChecksForServer skips deployments not synced', async () => {
      const config = { ...makeConfig(), deployments: [makeDepWithHealthPath()] };
      await service.runHealthChecksForServer('s1', config);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});

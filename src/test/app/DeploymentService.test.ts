import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeploymentService } from '@app/deployment/DeploymentService';
import { EventBus } from '@core/events/EventBus';
import type { Logger } from '@core/types/logger';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { IServerPlugin } from '@plugins/interfaces/IServerPlugin';
import type { ServerConfig, DeploymentConfig } from '@core/types/domain';
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

describe('DeploymentService', () => {
  let bus: EventBus;
  let service: DeploymentService;
  let mockPlugin: IServerPlugin;
  let mockRegistry: PluginRegistry;

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

    service = new DeploymentService({
      pluginRegistry: mockRegistry,
      bus,
      logger: mockLogger(),
    });
  });

  it('starts in undeployed state', () => {
    expect(service.getDeploymentState('s1', 'd1')).toBe('undeployed');
  });

  it('fullRedeploy transitions to synced on success', async () => {
    const config = makeConfig();
    const dep = makeDep();

    const events: unknown[] = [];
    bus.on('DeploymentStateChanged', e => events.push(e));

    const result = await service.fullRedeploy({} as never, config, dep);
    expect(result.ok).toBe(true);
    expect(service.getDeploymentState('s1', 'd1')).toBe('synced');
    // deploying → synced
    expect(events).toHaveLength(2);
  });

  it('fullRedeploy transitions to error on plan failure', async () => {
    (mockPlugin.planDeploy as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new JsmError({ code: ErrorCode.DeployFailed, message: 'plan failed' })),
    );

    const result = await service.fullRedeploy({} as never, makeConfig(), makeDep());
    expect(result.ok).toBe(false);
    expect(service.getDeploymentState('s1', 'd1')).toBe('error');
  });

  it('undeploy transitions from synced to undeployed', async () => {
    const config = makeConfig();
    const dep = makeDep();

    // First deploy
    await service.fullRedeploy({} as never, config, dep);
    expect(service.getDeploymentState('s1', 'd1')).toBe('synced');

    // Then undeploy
    const result = await service.undeploy({} as never, config, dep);
    expect(result.ok).toBe(true);
    expect(service.getDeploymentState('s1', 'd1')).toBe('undeployed');
  });

  it('undeploy from undeployed is a no-op success', async () => {
    const result = await service.undeploy({} as never, makeConfig(), makeDep());
    expect(result.ok).toBe(true);
    expect(mockPlugin.undeploy).not.toHaveBeenCalled();
  });

  it('sync falls back to fullRedeploy when plugin lacks deployIncremental', async () => {
    const config = makeConfig();
    const dep = makeDep();
    const batch = { changes: [], totalFiles: 0, totalBytes: 0 };

    await service.sync({} as never, config, dep, batch);
    expect(mockPlugin.planDeploy).toHaveBeenCalled();
    expect(mockPlugin.deployFull).toHaveBeenCalled();
  });

  it('throws on unsupported server type', async () => {
    (mockRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const config = { ...makeConfig(), type: 'unknown' as never };

    await expect(
      service.fullRedeploy({} as never, config, makeDep()),
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
      const result = await untrustedService.fullRedeploy({} as never, makeConfig(), makeDep());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    });

    it('blocks sync in untrusted workspace', async () => {
      const batch = { changes: [], totalFiles: 0, totalBytes: 0 };
      const result = await untrustedService.sync({} as never, makeConfig(), makeDep(), batch);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    });

    it('blocks undeploy in untrusted workspace', async () => {
      // First deploy in a trusted service, then try to undeploy in untrusted
      await service.fullRedeploy({} as never, makeConfig(), makeDep());
      const result = await untrustedService.undeploy({} as never, makeConfig(), makeDep());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    });
  });
});

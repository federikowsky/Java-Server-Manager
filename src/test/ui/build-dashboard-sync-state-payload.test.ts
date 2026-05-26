import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  configGet: vi.fn((_key: string, fallback?: unknown) => fallback),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mocked.configGet,
    })),
    isTrusted: true,
  },
}));

const { buildDashboardSyncStatePayload } = await import('@ui/webviews/panels/dashboard/buildDashboardSyncStatePayload');

function makeDeps() {
  return {
    workspaceRegistry: {
      getAllServers: vi.fn(() => []),
      getWorkspaceScopes: vi.fn(() => []),
    },
    lifecycle: {
      getRuntime: vi.fn(() => undefined),
    },
    templateService: {
      listScoped: vi.fn(() => []),
    },
    environmentProfileService: {
      listProfiles: vi.fn(() => []),
    },
    pluginRegistry: {
      getSupportedTypes: vi.fn(() => []),
      get: vi.fn(() => undefined),
    },
    operationHistory: undefined,
    autoSyncService: undefined,
    deployService: undefined,
    trustGate: {
      isTrusted: vi.fn(() => true),
    },
  };
}

describe('buildDashboardSyncStatePayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads stored showStatusInSidebar=false correctly', () => {
    mocked.configGet.mockImplementation((key: string, fallback?: unknown) => (
      key === 'ui.showStatusInSidebar' ? false : fallback
    ));

    const payload = buildDashboardSyncStatePayload(makeDeps() as never);

    expect(payload.settings.showStatusInSidebar).toBe(false);
  });

	  it('defaults showStatusInSidebar to true when the setting is absent', () => {
	    mocked.configGet.mockImplementation((_key: string, fallback?: unknown) => fallback);

	    const payload = buildDashboardSyncStatePayload(makeDeps() as never);

	    expect(payload.settings.showStatusInSidebar).toBe(true);
	    expect(payload.settings.localTelemetryEnabled).toBe(false);
	  });

  it('populates deploymentHealth correctly from deployService', () => {
    const deps = makeDeps();
    const server = {
      serverKey: 'ws1::s1',
      config: { deployments: [{ id: 'd1' }] },
      workspaceFolderUri: 'ws1',
    };
    const healthReport = { ok: true, latencyMs: 123 };

    deps.workspaceRegistry.getAllServers.mockReturnValue([server] as any);
    deps.deployService = {
      getDeploymentState: vi.fn(() => 'synced'),
      getDeploymentHealth: vi.fn((_sk: string, _did: string) => healthReport),
    } as any;

    const payload = buildDashboardSyncStatePayload(deps as any);

    expect(payload.deploymentHealth).toEqual({
      'ws1::s1': { d1: healthReport },
    });
    expect(deps.deployService.getDeploymentHealth).toHaveBeenCalledWith('ws1::s1', 'd1');
  });

  it('populates recent operation history when available', () => {
    const deps = makeDeps();
    deps.workspaceRegistry.getAllServers.mockReturnValue([{
      serverKey: 'ws1::s1',
      config: { id: 's1', deployments: [] },
      workspaceFolderUri: 'ws1',
      workspaceFolderName: 'ws',
    }] as any);
    deps.operationHistory = {
      getRecent: vi.fn(() => [{ operationId: 'op-1', kind: 'LifecycleStart', status: 'succeeded' }]),
    } as any;

    const payload = buildDashboardSyncStatePayload(deps as any);

    expect(payload.operationHistory).toEqual({
      'ws1::s1': [{ operationId: 'op-1', kind: 'LifecycleStart', status: 'succeeded' }],
    });
    expect(deps.operationHistory.getRecent).toHaveBeenCalledWith('ws1::s1', 8);
  });

  it('populates derived autosync diagnostics when available', () => {
    const deps = makeDeps();
    const config = { id: 's1', deployments: [] };
    deps.workspaceRegistry.getAllServers.mockReturnValue([{
      serverKey: 'ws1::s1',
      config,
      workspaceFolderUri: 'ws1',
      workspaceFolderName: 'ws',
    }] as any);
    deps.autoSyncService = {
      getDiagnostics: vi.fn(() => ({ enabled: true, watcherCount: 1, watcherCap: 64, deployments: [] })),
    } as any;

    const payload = buildDashboardSyncStatePayload(deps as any);

    expect(payload.autosyncDiagnostics).toEqual({
      'ws1::s1': { enabled: true, watcherCount: 1, watcherCap: 64, deployments: [] },
    });
    expect(deps.autoSyncService.getDiagnostics).toHaveBeenCalledWith('ws1::s1', config);
  });

  it('populates redacted environment profile summaries when available', async () => {
    const deps = makeDeps();
    deps.environmentProfileService.listProfiles.mockReturnValue([{
      id: 'team-local',
      name: 'Team Local',
      variables: {
        APP_ENV: { secret: false, value: 'local', hasValue: true, required: false },
        JSM_MANAGER_PASS: { secret: true, hasValue: true, required: true },
      },
    }]);

    const payload = buildDashboardSyncStatePayload(deps as any);

    expect(payload.environmentProfiles).toEqual([{
      id: 'team-local',
      name: 'Team Local',
      variables: {
        APP_ENV: { secret: false, value: 'local', hasValue: true, required: false },
        JSM_MANAGER_PASS: { secret: true, hasValue: true, required: true },
      },
    }]);
    expect(JSON.stringify(payload)).not.toContain('super-secret');
  });

  it('redacts secret server config values before syncing state to the webview', () => {
    const deps = makeDeps();
    const config = {
      id: 's1',
      run: {
        env: {
          APP_ENV: 'local',
          JSM_MANAGER_PASS: 'secret',
        },
      },
      pluginConfig: {
        type: 'tomcat',
        ssl: {
          enabled: true,
          keystorePassword: 'changeit',
          truststorePassword: 'trustme',
        },
      },
    };
    deps.workspaceRegistry.getAllServers.mockReturnValue([{
      serverKey: 'ws1::s1',
      config,
      workspaceFolderUri: 'ws1',
      workspaceFolderName: 'ws',
    }] as any);

    const payload = buildDashboardSyncStatePayload(deps as any);

    expect((payload.servers[0].config as any).run.env).toEqual({
      APP_ENV: 'local',
      JSM_MANAGER_PASS: '[redacted]',
    });
    expect((payload.servers[0].config as any).pluginConfig.ssl).toMatchObject({
      keystorePassword: '[redacted]',
      truststorePassword: '[redacted]',
    });
    expect(config.run.env.JSM_MANAGER_PASS).toBe('secret');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { Logger } from '@core/types/logger';
import type { ServerConfig } from '@core/types/domain';
import { ServerProvisioningService } from '@app/server/ServerProvisioningService';
import { ManagedInstancePathResolver } from '@app/server/ManagedInstancePathResolver';

vi.mock('fs/promises', () => ({
  rm: vi.fn(async () => undefined),
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function mockPlugin() {
  return {
    getDefaultConfig: vi.fn(() => ({
      host: '127.0.0.1',
      ports: { http: 8080, debug: 5005 },
      run: { env: {}, vmArgs: [] },
      debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
      autosync: {
        enabled: true,
        debounceMs: 400,
        maxBatchFiles: 200,
        maxBatchBytes: 20_000_000,
        stormBackoffMs: 2000,
        ignoreGlobs: ['**/.git/**'],
      },
      pluginConfig: { type: 'tomcat', shutdownPort: 8005, disableAjp: true },
    })),
    detectInstallation: vi.fn(async () => ok({ ok: true, version: '10.1', checks: [], warnings: [] })),
    validateConfig: vi.fn(async () => ok(undefined)),
    initializeInstancePath: vi.fn(async () => ok(undefined)),
  };
}

function mockPluginRegistry(plugin: ReturnType<typeof mockPlugin>) {
  return {
    get: vi.fn(() => plugin),
  };
}

function mockConfigService() {
  return {
    getServer: vi.fn((_id: string) => undefined as ServerConfig | undefined),
    addServer: vi.fn(async (_cfg: ServerConfig) => ok(undefined)),
    removeServer: vi.fn(async (_id: string) => ok(undefined)),
  };
}

describe('ServerProvisioningService', () => {
  let plugin: ReturnType<typeof mockPlugin>;
  let pluginRegistry: ReturnType<typeof mockPluginRegistry>;
  let configService: ReturnType<typeof mockConfigService>;
  let service: ServerProvisioningService;

  beforeEach(() => {
    plugin = mockPlugin();
    pluginRegistry = mockPluginRegistry(plugin);
    configService = mockConfigService();
    service = new ServerProvisioningService({
      configService: configService as any,
      pluginRegistry: pluginRegistry as any,
      pathResolver: new ManagedInstancePathResolver('/managed-storage'),
      logger: mockLogger(),
    });
  });

  it('provisions a managed server and persists it', async () => {
    const result = await service.createServer({
      name: 'Managed Tomcat',
      runtimeHomePath: '/opt/tomcat',
      javaHome: '/opt/java',
    });

    expect(result.ok).toBe(true);
    expect(plugin.detectInstallation).toHaveBeenCalledWith('/opt/tomcat');
    expect(plugin.initializeInstancePath).toHaveBeenCalledWith(
      '/opt/tomcat',
      '/managed-storage/instances/test-uuid-1234',
      expect.objectContaining({
        name: 'Managed Tomcat',
        instancePath: '/managed-storage/instances/test-uuid-1234',
      }),
    );
    expect(configService.addServer).toHaveBeenCalledWith(expect.objectContaining({
      instancePath: '/managed-storage/instances/test-uuid-1234',
      runtime: expect.objectContaining({ homePath: '/opt/tomcat', version: '10.1' }),
    }));
  });

  it('propagates plugin detection failure', async () => {
    plugin.detectInstallation.mockResolvedValue(
      err(new JsmError({ code: ErrorCode.ValidationFailed, message: 'bad runtime' })),
    );

    const result = await service.createServer({
      name: 'Managed Tomcat',
      runtimeHomePath: '/bad/tomcat',
      javaHome: '/opt/java',
    });

    expect(result.ok).toBe(false);
    expect(plugin.initializeInstancePath).not.toHaveBeenCalled();
    expect(configService.addServer).not.toHaveBeenCalled();
  });

  it('does not persist when managed bootstrap fails', async () => {
    plugin.initializeInstancePath.mockResolvedValue(
      err(new JsmError({ code: ErrorCode.DeployFailed, message: 'init failed' })),
    );

    const result = await service.createServer({
      name: 'Managed Tomcat',
      runtimeHomePath: '/opt/tomcat',
      javaHome: '/opt/java',
    });

    expect(result.ok).toBe(false);
    expect(configService.addServer).not.toHaveBeenCalled();
  });

  it('removes config and managed instance on delete', async () => {
    configService.getServer.mockReturnValue({
      id: 'srv-1',
      name: 'Managed Tomcat',
      type: 'tomcat',
      runtime: { id: 'rt-1', homePath: '/opt/tomcat', version: '10.1' },
      instancePath: '/managed-storage/instances/srv-1',
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
    } as ServerConfig);

    const result = await service.removeServer('srv-1');

    expect(result.ok).toBe(true);
    expect(configService.removeServer).toHaveBeenCalledWith('srv-1');
    expect(fs.rm).toHaveBeenCalledWith('/managed-storage/instances/srv-1', { recursive: true, force: true });
  });

  it('returns a surfaced error when managed instance cleanup fails after config removal', async () => {
    configService.getServer.mockReturnValue({
      id: 'srv-1',
      name: 'Managed Tomcat',
      type: 'tomcat',
      runtime: { id: 'rt-1', homePath: '/opt/tomcat', version: '10.1' },
      instancePath: '/managed-storage/instances/srv-1',
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
    } as ServerConfig);
    vi.mocked(fs.rm).mockRejectedValueOnce(new Error('permission denied'));

    const result = await service.removeServer('srv-1');

    expect(result.ok).toBe(false);
    expect(configService.removeServer).toHaveBeenCalledWith('srv-1');
    if (!result.ok) {
      expect(result.error.message).toContain('cleanup failed');
    }
  });
});

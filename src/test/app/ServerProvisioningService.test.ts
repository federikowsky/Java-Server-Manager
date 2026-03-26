import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@core/result';
import { ErrorCode } from '@core/errors/codes';
import type { Logger } from '@core/types/logger';
import type { ServerConfig } from '@core/types/domain';
import { ServerProvisioningService } from '@app/server/ServerProvisioningService';

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

describe('ServerProvisioningService', () => {
  let configService: {
    addServer: ReturnType<typeof vi.fn>;
    removeServer: ReturnType<typeof vi.fn>;
    getServer: ReturnType<typeof vi.fn>;
  };
  let pluginRegistry: {
    get: ReturnType<typeof vi.fn>;
  };
  let pathResolver: {
    resolve: ReturnType<typeof vi.fn>;
  };
  let trustGate: {
    isTrusted: ReturnType<typeof vi.fn>;
  };
  let service: ServerProvisioningService;

  beforeEach(() => {
    configService = {
      addServer: vi.fn(async () => ok(undefined)),
      removeServer: vi.fn(async () => ok(undefined)),
      getServer: vi.fn(() => makeServer()),
    };
    pluginRegistry = {
      get: vi.fn(() => ({
        detectInstallation: vi.fn(async () => ok({ ok: true, version: '10.1', checks: [], warnings: [] })),
        getDefaultConfig: vi.fn(() => ({})),
        validateConfig: vi.fn(async () => ok(undefined)),
        initializeInstancePath: vi.fn(async () => ok(undefined)),
      })),
    };
    pathResolver = {
      resolve: vi.fn(() => '/tmp/managed'),
    };
    trustGate = {
      isTrusted: vi.fn(() => true),
    };
    service = new ServerProvisioningService({
      configService: configService as never,
      pluginRegistry: pluginRegistry as never,
      pathResolver: pathResolver as never,
      logger: mockLogger(),
      trustGate,
    });
  });

  it('blocks createServer before any provisioning side effects when workspace is untrusted', async () => {
    trustGate.isTrusted.mockReturnValue(false);

    const result = await service.createServer({
      name: 'My Tomcat',
      type: 'tomcat',
      runtimeHomePath: '/opt/tomcat',
      javaHome: '/usr/lib/jvm/java-17',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    }
    expect(pluginRegistry.get).not.toHaveBeenCalled();
    expect(pathResolver.resolve).not.toHaveBeenCalled();
    expect(configService.addServer).not.toHaveBeenCalled();
  });

  it('blocks duplicateServer before any provisioning side effects when workspace is untrusted', async () => {
    trustGate.isTrusted.mockReturnValue(false);

    const result = await service.duplicateServer(makeServer());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    }
    expect(pluginRegistry.get).not.toHaveBeenCalled();
    expect(pathResolver.resolve).not.toHaveBeenCalled();
    expect(configService.addServer).not.toHaveBeenCalled();
  });

  it('blocks removeServer before config or filesystem cleanup when workspace is untrusted', async () => {
    trustGate.isTrusted.mockReturnValue(false);

    const result = await service.removeServer('srv-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
    }
    expect(configService.getServer).not.toHaveBeenCalled();
    expect(configService.removeServer).not.toHaveBeenCalled();
  });
});

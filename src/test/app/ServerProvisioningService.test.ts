import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
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
  let tmpDir: string;
  let managedRoot: string;
  let managedInstancePath: string;
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
    getStorageRoot: ReturnType<typeof vi.fn>;
  };
  let trustGate: {
    isTrusted: ReturnType<typeof vi.fn>;
  };
  let service: ServerProvisioningService;

  beforeEach(() => {
    tmpDir = '';
    managedRoot = '';
    managedInstancePath = '';
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
      getStorageRoot: vi.fn(() => '/tmp'),
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

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setupManagedPaths(): Promise<void> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-provisioning-'));
    managedRoot = path.join(tmpDir, 'instances');
    managedInstancePath = path.join(managedRoot, 'srv-1');
    await fs.mkdir(managedInstancePath, { recursive: true });
    pathResolver.getStorageRoot = vi.fn(() => managedRoot);
  }

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

  it('plans a duplicate without writing managed instance files or inventory', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-plan-'));
    const plannedPath = path.join(tmpDir, 'planned-only');
    pathResolver.resolve.mockReturnValue(plannedPath);
    const source = makeServer('srv-source', 'Imported Tomcat');

    const result = await service.planDuplicateServer(source, { keepName: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).not.toBe(source.id);
    expect(result.value.runtime.id).not.toBe(source.runtime.id);
    expect(result.value.name).toBe('Imported Tomcat');
    expect(result.value.instancePath).toBe(plannedPath);
    expect(pathResolver.resolve).toHaveBeenCalledWith(result.value.id);
    expect(configService.addServer).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(plannedPath, '.jsm-managed-instance'))).rejects.toBeDefined();
  });

  it('applies a planned duplicate using the planned identity and instance path', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-planned-'));
    const plannedPath = path.join(tmpDir, 'planned-instance');
    const source = makeServer('srv-source', 'Imported Tomcat');
    const planned = {
      ...makeServer('srv-planned', 'Imported Tomcat'),
      instancePath: plannedPath,
      runtime: { id: 'rt-planned', homePath: source.runtime.homePath, version: '10.1' },
    };

    const result = await service.provisionPlannedDuplicate(source, planned);

    expect(result.ok).toBe(true);
    expect(configService.addServer).toHaveBeenCalledWith(planned);
    await expect(fs.readFile(path.join(plannedPath, '.jsm-managed-instance'), 'utf8'))
      .resolves.toContain('srv-planned');
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

  it('refuses to remove config when instancePath is outside managed storage', async () => {
    await setupManagedPaths();
    const outsidePath = path.join(tmpDir, 'outside');
    await fs.mkdir(outsidePath, { recursive: true });
    configService.getServer.mockReturnValue(makeServer('srv-1', 'Unsafe'));
    configService.getServer.mockReturnValueOnce({
      ...makeServer('srv-1', 'Unsafe'),
      instancePath: outsidePath,
    });

    const result = await service.removeServer('srv-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('not a managed JSM instance path');
    }
    expect(configService.removeServer).not.toHaveBeenCalled();
    await expect(fs.stat(outsidePath)).resolves.toBeDefined();
  });

  it('refuses to remove config when managed marker is missing', async () => {
    await setupManagedPaths();
    configService.getServer.mockReturnValue({
      ...makeServer('srv-1', 'Unmarked'),
      instancePath: managedInstancePath,
    });

    const result = await service.removeServer('srv-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('managed marker');
    }
    expect(configService.removeServer).not.toHaveBeenCalled();
    await expect(fs.stat(managedInstancePath)).resolves.toBeDefined();
  });

  it('removes marked managed instance before deleting config authority', async () => {
    await setupManagedPaths();
    await fs.writeFile(path.join(managedInstancePath, '.jsm-managed-instance'), 'srv-1\n', 'utf8');
    configService.getServer.mockReturnValue({
      ...makeServer('srv-1', 'Managed'),
      instancePath: managedInstancePath,
    });

    const result = await service.removeServer('srv-1');

    expect(result.ok).toBe(true);
    expect(configService.removeServer).toHaveBeenCalledWith('srv-1');
    await expect(fs.stat(managedInstancePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ServerDoctorService } from '@app/doctor';
import type { ServerConfig } from '@core/types';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 'srv-1',
    name: 'Tomcat',
    type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/tomcat', version: '10.1' },
    instancePath: '/instance',
    javaHome: '/jdk',
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
    ...overrides,
  };
}

function makeService(options?: {
  trusted?: boolean;
  portFree?: boolean;
  detectOk?: boolean;
  validateOk?: boolean;
}) {
  const plugin = {
    detectInstallation: vi.fn(async () => ok({
      ok: options?.detectOk ?? true,
      version: '10.1',
      checks: [{
        id: 'catalina-script',
        ok: options?.detectOk ?? true,
        message: options?.detectOk === false ? 'Missing catalina.sh' : 'Found catalina.sh',
      }],
      warnings: ['Could not detect Tomcat version from RELEASE-NOTES'],
    })),
    validateConfig: vi.fn(async () => (
      options?.validateOk === false
        ? err(new JsmError({
          code: ErrorCode.ValidationFailed,
          message: 'Tomcat configuration validation failed',
          suggestedFix: ['Java executable not found'],
        }))
        : ok(undefined)
    )),
  };
  const registry = {
    get: vi.fn(() => plugin),
  };
  const probe = {
    isPortFree: vi.fn(async () => options?.portFree ?? true),
  };

  return {
    service: new ServerDoctorService({
      pluginRegistry: registry as never,
      portProbe: probe,
      trustGate: { isTrusted: () => options?.trusted ?? true },
    }),
    plugin,
    probe,
  };
}

describe('ServerDoctorService', () => {
  it('reports deterministic findings for plugin checks, paths, deployments, and ports', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-doctor-'));
    const runtimeHome = path.join(tmp, 'tomcat');
    const instancePath = path.join(tmp, 'instance');
    const javaHome = path.join(tmp, 'jdk');
    const deploymentSource = path.join(tmp, 'app.war');
    await fs.mkdir(path.join(runtimeHome, 'bin'), { recursive: true });
    await fs.mkdir(path.join(javaHome, 'bin'), { recursive: true });
    await fs.mkdir(instancePath, { recursive: true });
    await fs.writeFile(deploymentSource, 'war');
    await fs.writeFile(path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), '');

    const { service, plugin, probe } = makeService();
    const config = makeConfig({
      runtime: { id: 'rt-1', homePath: runtimeHome },
      instancePath,
      javaHome,
      deployments: [{
        id: 'dep-1',
        type: 'war',
        sourcePath: deploymentSource,
        deployName: 'app',
        syncMode: 'manual',
        hotReload: false,
        ignoreGlobs: [],
        hooks: [],
      }],
    });

    const result = await service.inspect({ config, workspaceFolderFsPath: tmp, serverState: 'stopped' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary.errors).toBe(0);
    expect(result.value.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'trust.workspace', severity: 'pass' }),
      expect.objectContaining({ id: 'plugin.tomcat', severity: 'pass' }),
      expect.objectContaining({ id: 'runtime.catalina-script', severity: 'pass' }),
      expect.objectContaining({ id: 'path.javaHome', severity: 'pass' }),
      expect.objectContaining({ id: 'path.instancePath', severity: 'pass' }),
      expect.objectContaining({ id: 'deployment.dep-1.source', severity: 'pass' }),
      expect.objectContaining({ id: 'port.http', severity: 'pass' }),
    ]));
    expect(plugin.detectInstallation).toHaveBeenCalledWith(runtimeHome);
    expect(plugin.validateConfig).toHaveBeenCalledWith(config);
    expect(probe.isPortFree).toHaveBeenCalledWith(8080, '127.0.0.1');
  });

  it('fails closed for untrusted workspaces and missing deployment source', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-doctor-'));
    const { service } = makeService({ trusted: false, portFree: false, detectOk: false, validateOk: false });
    const config = makeConfig({
      deployments: [{
        id: 'dep-1',
        type: 'war',
        sourcePath: 'missing.war',
        deployName: 'app',
        syncMode: 'manual',
        hotReload: false,
        ignoreGlobs: [],
        hooks: [],
      }],
    });

    const result = await service.inspect({ config, workspaceFolderFsPath: tmp, serverState: 'stopped' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary.errors).toBeGreaterThanOrEqual(4);
    expect(result.value.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'trust.workspace', severity: 'error' }),
      expect.objectContaining({ id: 'runtime.catalina-script', severity: 'error' }),
      expect.objectContaining({ id: 'config.validation', severity: 'error' }),
      expect.objectContaining({ id: 'deployment.dep-1.source', severity: 'error' }),
      expect.objectContaining({ id: 'port.http', severity: 'error' }),
    ]));
  });

  it('does not flag occupied ports as errors when the server is already running', async () => {
    const { service } = makeService({ portFree: false });
    const result = await service.inspect({ config: makeConfig(), serverState: 'running' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toContainEqual(expect.objectContaining({
      id: 'port.http',
      severity: 'info',
      message: expect.stringContaining('already running'),
    }));
  });
});

import { describe, it, expect } from 'vitest';
import { DiagnosticsService } from '@app/diagnostics/DiagnosticsService';
import type { ServerConfig } from '@core/types/domain';

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 's1',
    name: 'Test Server',
    type: 'tomcat',
    runtime: { id: 'rt1', homePath: '/opt/tomcat', version: '10.1' },
    instancePath: '/tmp/inst',
    javaHome: '/opt/java',
    host: '127.0.0.1',
    ports: { http: 8080, debug: 5005 },
    run: {
      env: { JAVA_HOME: '/opt/java', DB_PASSWORD: 's3cret' },
      vmArgs: ['-Xmx512m'],
    },
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

describe('DiagnosticsService', () => {
  it('generates a bundle with timestamp and version', () => {
    const service = new DiagnosticsService({
      extensionVersion: '1.0.0',
      getConfigs: () => [],
      getRuntimeState: () => undefined,
      getLogBuffer: () => '',
    });

    const bundle = service.generateBundle();
    expect(bundle.timestamp).toBeDefined();
    expect(bundle.extensionVersion).toBe('1.0.0');
    expect(bundle.servers).toEqual([]);
  });

  it('includes server configs in the bundle', () => {
    const config = makeConfig();
    const service = new DiagnosticsService({
      extensionVersion: '1.0.0',
      getConfigs: () => [config],
      getRuntimeState: () => ({ serverId: 's1', state: 'running', lastTransitionAt: Date.now() }),
      getLogBuffer: () => '',
    });

    const bundle = service.generateBundle();
    expect(bundle.servers).toHaveLength(1);
    expect(bundle.servers[0].runtimeState?.state).toBe('running');
  });

  it('redacts sensitive env values', () => {
    const config = makeConfig();
    const service = new DiagnosticsService({
      extensionVersion: '1.0.0',
      getConfigs: () => [config],
      getRuntimeState: () => undefined,
      getLogBuffer: () => '',
    });

    const bundle = service.generateBundle();
    const env = bundle.servers[0].config.run.env;
    expect(env['JAVA_HOME']).toBe('/opt/java');
    expect(env['DB_PASSWORD']).toBe('***REDACTED***');
  });

  it('redacts sensitive patterns in logs', () => {
    const logText = 'INFO: connecting with password=s3cretValue and token=abc123';
    const service = new DiagnosticsService({
      extensionVersion: '1.0.0',
      getConfigs: () => [],
      getRuntimeState: () => undefined,
      getLogBuffer: () => logText,
    });

    const bundle = service.generateBundle();
    expect(bundle.logs).not.toContain('s3cretValue');
    expect(bundle.logs).not.toContain('abc123');
    expect(bundle.logs).toContain('***REDACTED***');
  });

  it('generates valid JSON text', () => {
    const service = new DiagnosticsService({
      extensionVersion: '1.0.0',
      getConfigs: () => [makeConfig()],
      getRuntimeState: () => undefined,
      getLogBuffer: () => 'some log',
    });

    const text = service.generateBundleText();
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

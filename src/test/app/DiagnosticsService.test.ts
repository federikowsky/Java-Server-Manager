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

  it('redacts sensitive values across nested config, hooks, and JVM args', () => {
    const config = makeConfig({
      run: {
        env: { JAVA_HOME: '/opt/java', DB_PASSWORD: 'env-secret' },
        vmArgs: [
          '-Xmx512m',
          '-Ddb.password=vm-secret',
          '-Dauth.token=vm-token',
          '-Djavax.net.ssl.keyStorePassword=vm-keystore-secret',
        ],
      },
      pluginConfig: {
        type: 'tomcat',
        shutdownPort: 8005,
        disableAjp: true,
        ssl: {
          enabled: true,
          port: 8443,
          keystorePath: '/secure/server.p12',
          keystorePassword: 'keystore-secret',
          keystoreType: 'PKCS12',
          keyPassword: 'key-secret',
          clientAuth: true,
          truststorePath: '/secure/trust.p12',
          truststorePassword: 'trust-secret',
          truststoreType: 'PKCS12',
        },
      },
      hooks: [
        {
          id: 'deploy-hook',
          enabled: true,
          phase: 'pre',
          event: 'deploy.full',
          kind: 'command',
          timeoutMs: 60_000,
          continueOnError: false,
          command: {
            mode: 'shell',
            line: 'curl -H "Authorization: Bearer hook-token" https://example.test/deploy?password=hook-line-secret',
            env: { API_TOKEN: 'hook-env-secret', PUBLIC_FLAG: 'visible' },
          },
        },
      ],
      deployments: [
        {
          id: 'dep-1',
          type: 'exploded',
          sourcePath: '/src/app',
          deployName: 'app',
          syncMode: 'manual',
          hotReload: false,
          ignoreGlobs: [],
          hooks: [
            {
              id: 'dep-hook',
              enabled: true,
              phase: 'post',
              event: 'deploy.full',
              kind: 'command',
              timeoutMs: 60_000,
              continueOnError: false,
              command: {
                mode: 'shell',
                line: 'echo secret=deployment-line-secret',
                env: { DEPLOY_SECRET: 'deployment-env-secret' },
              },
            },
          ],
        },
      ],
    });
    const service = new DiagnosticsService({
      extensionVersion: '1.0.0',
      getConfigs: () => [config],
      getRuntimeState: () => undefined,
      getLogBuffer: () => '',
    });

    const text = service.generateBundleText();

    for (const leaked of [
      'env-secret',
      'vm-secret',
      'vm-token',
      'vm-keystore-secret',
      'keystore-secret',
      'key-secret',
      'trust-secret',
      'hook-token',
      'hook-line-secret',
      'hook-env-secret',
      'deployment-line-secret',
      'deployment-env-secret',
    ]) {
      expect(text).not.toContain(leaked);
    }
    expect(text).toContain('/secure/server.p12');
    expect(text).toContain('visible');
  });

  it('redacts sensitive patterns in logs', () => {
    const logText = 'INFO: connecting with password=s3cretValue and token=abc123 and -Djavax.net.ssl.keyStorePassword=changeit';
    const service = new DiagnosticsService({
      extensionVersion: '1.0.0',
      getConfigs: () => [],
      getRuntimeState: () => undefined,
      getLogBuffer: () => logText,
    });

    const bundle = service.generateBundle();
    expect(bundle.logs).not.toContain('s3cretValue');
    expect(bundle.logs).not.toContain('abc123');
    expect(bundle.logs).not.toContain('changeit');
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

  it('includes local telemetry only when the opt-in snapshot is available', () => {
    const service = new DiagnosticsService({
      extensionVersion: '1.0.0',
      getConfigs: () => [],
      getRuntimeState: () => undefined,
      getLogBuffer: () => '',
      getLocalTelemetrySnapshot: () => ({
        version: 1,
        enabled: true,
        createdAt: '2026-05-24T12:00:00.000Z',
        updatedAt: '2026-05-24T12:00:00.000Z',
        counters: {
          operations: { succeeded: 1, failed: 0 },
          operationsByKind: { LifecycleStart: { succeeded: 1, failed: 0 } },
          inventory: {
            serversAdded: 0,
            serversDeleted: 0,
            deploymentsAdded: 0,
            deploymentsRemoved: 0,
          },
        },
      }),
    });

    expect(service.generateBundle().localTelemetry?.counters.operations.succeeded).toBe(1);
  });
});

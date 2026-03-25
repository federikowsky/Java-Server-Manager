import { describe, it, expect } from 'vitest';
import { resolveAutosyncWatchSpec } from '@app/sync/watchSpec';
import type { ServerConfig, DeploymentConfig } from '@core/types/domain';

function baseServer(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 's1',
    name: 'Test',
    type: 'tomcat',
    runtime: { id: 'rt1', homePath: '/opt/tomcat' },
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
      ignoreGlobs: ['**/node_modules/**'],
    },
    hooks: [],
    ...overrides,
  };
}

function dep(overrides: Partial<DeploymentConfig>): DeploymentConfig {
  return {
    id: 'd1',
    type: 'exploded',
    sourcePath: '/src/app',
    deployName: 'app',
    syncMode: 'auto',
    hotReload: false,
    ignoreGlobs: ['**/tmp/**'],
    hooks: [],
    ...overrides,
  };
}

describe('resolveAutosyncWatchSpec', () => {
  it('returns tree spec for exploded + auto', () => {
    const config = baseServer();
    const spec = resolveAutosyncWatchSpec(config, dep({ type: 'exploded', syncMode: 'auto' }));
    expect(spec).toEqual({
      kind: 'tree',
      root: '/src/app',
      ignoreGlobs: ['**/node_modules/**', '**/tmp/**'],
    });
  });

  it('returns undefined for manual sync', () => {
    const config = baseServer();
    expect(resolveAutosyncWatchSpec(config, dep({ syncMode: 'manual' }))).toBeUndefined();
  });

  it('returns file spec for war + auto', () => {
    const config = baseServer();
    const spec = resolveAutosyncWatchSpec(
      config,
      dep({ type: 'war', sourcePath: '/target/app.war', syncMode: 'auto' }),
    );
    expect(spec).toEqual({ kind: 'file', path: '/target/app.war' });
  });

  it('returns undefined for war + manual', () => {
    const config = baseServer();
    expect(
      resolveAutosyncWatchSpec(
        config,
        dep({ type: 'war', sourcePath: '/t.war', syncMode: 'manual' }),
      ),
    ).toBeUndefined();
  });
});

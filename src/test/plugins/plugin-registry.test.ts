import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { IServerPlugin } from '@plugins/interfaces/IServerPlugin';
import type { Logger } from '@core/types/logger';
import { ok } from '@core/result';

// ── Test Logger ─────────────────────────────────────────────────────────────

function noopLogger(): Logger {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => noopLogger(),
  };
}

// ── Stub Plugin ─────────────────────────────────────────────────────────────

function stubPlugin(overrides: Partial<IServerPlugin> = {}): IServerPlugin {
  return {
    type: 'tomcat',
    displayName: 'Test Tomcat',
    getCapabilities: () => ({
      supportsDebugAttach: true,
      supportsExplodedDeploy: true,
      supportsWarDeploy: true,
      supportsIncrementalDeploy: true,
      supportsHotReload: true,
      supportsLogFollow: true,
      supportsAutoDetect: true,
      supportsMultipleInstances: true,
      supportsSsl: false,
    }),
    detectInstallation: async () => ok({
      ok: false,
      checks: [],
      warnings: [],
    }),
    validateConfig: async () => ok(undefined),
    start: async () => ok({ pid: 1234, hints: [] }),
    stop: async () => ok(undefined),
    planDeploy: async () => ok({
      targetRoot: '/webapps',
      targetPath: '/webapps/test',
      strategy: 'copy-dir' as const,
      notes: [],
    }),
    deployFull: async () => ok({
      strategy: 'copy-dir' as const,
      deployedPath: '/webapps/test',
      warnings: [],
    }),
    undeploy: async () => ok(undefined),
    getStatus: async () => ok({ state: 'stopped' as const }),
    getLogSources: async () => ok({ others: [] }),
    getDefaultConfig: () => ({}),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PluginRegistry', () => {
  let registry: PluginRegistry;
  const logger = noopLogger();

  beforeEach(() => {
    registry = new PluginRegistry(logger);
  });

  it('has() returns false for unregistered type', () => {
    expect(registry.has('tomcat')).toBe(false);
  });

  it('register + has() returns true', () => {
    registry.register('tomcat', () => stubPlugin());
    expect(registry.has('tomcat')).toBe(true);
  });

  it('get() lazily creates and caches the plugin instance', () => {
    let callCount = 0;
    registry.register('tomcat', () => {
      callCount++;
      return stubPlugin();
    });

    const a = registry.get('tomcat');
    const b = registry.get('tomcat');

    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(callCount).toBe(1);
  });

  it('get() returns undefined for unregistered type', () => {
    expect(registry.get('tomcat')).toBeUndefined();
  });

  it('getSupportedTypes() returns registered types', () => {
    registry.register('tomcat', () => stubPlugin());
    expect(registry.getSupportedTypes()).toEqual(['tomcat']);
  });

  it('detectServerType() returns the matching plugin', async () => {
    registry.register('tomcat', () => stubPlugin({
      detectInstallation: async () => ok({
        ok: true,
        version: '10.1.0',
        checks: [{ id: 'test', ok: true, message: 'ok' }],
        warnings: [],
      }),
    }));

    const result = await registry.detectServerType('/some/path');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe('tomcat');
      expect(result.value.report.version).toBe('10.1.0');
    }
  });

  it('detectServerType() returns error when no plugin matches', async () => {
    registry.register('tomcat', () => stubPlugin({
      detectInstallation: async () => ok({
        ok: false,
        checks: [{ id: 'test', ok: false, message: 'fail' }],
        warnings: [],
      }),
    }));

    const result = await registry.detectServerType('/some/path');
    expect(result.ok).toBe(false);
  });

  it('dispose() clears all instances and factories', async () => {
    let disposed = false;
    registry.register('tomcat', () => stubPlugin({
      dispose: async () => { disposed = true; },
    }));
    // Force instance creation
    registry.get('tomcat');

    await registry.dispose();

    expect(disposed).toBe(true);
    expect(registry.has('tomcat')).toBe(false);
    expect(registry.getSupportedTypes()).toEqual([]);
  });
});

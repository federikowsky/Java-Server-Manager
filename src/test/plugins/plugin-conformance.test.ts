import { describe, expect, it, vi } from 'vitest';
import type { IServerPlugin, PluginCapabilities, PluginUIMetadata } from '@plugins/interfaces/IServerPlugin';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { DeploymentConfig, OperationContext, ServerConfig } from '@core/types';

const capabilityKeys: Array<keyof PluginCapabilities> = [
  'supportsDebugAttach',
  'supportsExplodedDeploy',
  'supportsWarDeploy',
  'supportsIncrementalDeploy',
  'supportsHotReload',
  'supportsLogFollow',
  'supportsAutoDetect',
  'supportsMultipleInstances',
  'supportsSsl',
];

const metadataKeys: Array<keyof PluginUIMetadata> = [
  'displayName',
  'runtimeHomeLabel',
  'runtimeHomeHelp',
  'defaultName',
  'discoveryDescription',
];

function ctx(): OperationContext {
  return {
    operationId: 'op-1',
    serverId: 'srv-1',
    kind: 'LifecycleStart',
    startedAt: Date.now(),
    timeoutMs: 1000,
    cancel: {
      isCancelled: false,
      onCancelled: () => ({ dispose: vi.fn() }),
    },
    progress: { report: vi.fn() },
    output: { append: vi.fn(), appendLine: vi.fn(), clear: vi.fn() },
  };
}

function server(): ServerConfig {
  return {
    id: 'srv-1',
    name: 'Fixture Server',
    type: 'tomcat',
    runtime: { id: 'fixture-runtime', homePath: '/fixture/runtime' },
    instancePath: '/fixture/instance',
    javaHome: '/fixture/jdk',
    host: '127.0.0.1',
    ports: { http: 8080, debug: 5005 },
    run: { env: {}, vmArgs: [] },
    debug: { enabled: false, bind: '127.0.0.1', attachDelayMs: 0 },
    deployments: [],
    autosync: {
      enabled: false,
      debounceMs: 400,
      maxBatchFiles: 1,
      maxBatchBytes: 1,
      stormBackoffMs: 0,
      ignoreGlobs: [],
    },
    hooks: [],
  };
}

function deployment(): DeploymentConfig {
  return {
    id: 'dep-1',
    type: 'war',
    sourcePath: '/fixture/app.war',
    deployName: 'fixture',
    syncMode: 'manual',
    hotReload: false,
    ignoreGlobs: [],
    hooks: [],
  };
}

function fixturePlugin(): IServerPlugin {
  return {
    type: 'tomcat',
    displayName: 'Fixture Server',
    getCapabilities: () => ({
      supportsDebugAttach: false,
      supportsExplodedDeploy: false,
      supportsWarDeploy: true,
      supportsIncrementalDeploy: false,
      supportsHotReload: false,
      supportsLogFollow: false,
      supportsAutoDetect: false,
      supportsMultipleInstances: true,
      supportsSsl: false,
    }),
    getUIMetadata: () => ({
      displayName: 'Fixture Server',
      runtimeHomeLabel: 'FIXTURE_HOME',
      runtimeHomeHelp: 'Path to a fixture runtime.',
      defaultName: 'Fixture Server',
      discoveryEnvVars: [],
      discoveryPaths: [],
      discoveryDescription: 'No automatic discovery for fixture plugin.',
    }),
    detectInstallation: async () => ok({
      ok: false,
      checks: [{ id: 'fixture-home', ok: false, message: 'Fixture runtime not installed' }],
      warnings: [],
    }),
    validateConfig: async config => (
      config.runtime.homePath.includes('fixture')
        ? ok(undefined)
        : err(new JsmError({ code: ErrorCode.ValidationFailed, message: 'Not a fixture runtime' }))
    ),
    initializeInstancePath: async () => ok(undefined),
    start: async () => ok({ pid: 123, hints: [] }),
    stop: async () => ok(undefined),
    planDeploy: async (_ctx, _config, dep) => ok({
      targetRoot: '/fixture/deployments',
      targetPath: `/fixture/deployments/${dep.deployName}`,
      strategy: 'copy-war',
      notes: [],
    }),
    deployFull: async (_ctx, _config, _dep, plan) => ok({
      strategy: plan.strategy,
      deployedPath: plan.targetPath,
      warnings: [],
    }),
    undeploy: async () => ok(undefined),
    getStatus: async () => ok({ state: 'stopped' }),
    getLogSources: async () => ok({ others: [] }),
    getDefaultConfig: () => ({
      host: '127.0.0.1',
      debug: { enabled: false, bind: '127.0.0.1', attachDelayMs: 0 },
    }),
  };
}

describe('IServerPlugin conformance fixture', () => {
  it('provides complete boolean capabilities and stable UI metadata', () => {
    const plugin = fixturePlugin();
    const capabilities = plugin.getCapabilities();
    const metadata = plugin.getUIMetadata();

    for (const key of capabilityKeys) {
      expect(typeof capabilities[key], key).toBe('boolean');
    }
    for (const key of metadataKeys) {
      expect(typeof metadata[key], key).toBe('string');
      expect((metadata[key] as string).trim().length, key).toBeGreaterThan(0);
    }
    expect(Array.isArray(metadata.discoveryEnvVars)).toBe(true);
    expect(Array.isArray(metadata.discoveryPaths)).toBe(true);
  });

  it('fails closed for unsupported discovery while still supporting required methods', async () => {
    const plugin = fixturePlugin();
    const detectResult = await plugin.detectInstallation('/unknown');
    expect(detectResult.ok).toBe(true);
    if (detectResult.ok) {
      expect(detectResult.value.ok).toBe(false);
      expect(detectResult.value.checks[0].ok).toBe(false);
    }

    await expect(plugin.validateConfig(server())).resolves.toEqual(ok(undefined));
    await expect(plugin.start(ctx(), server(), 'run')).resolves.toMatchObject({ ok: true });
    await expect(plugin.stop(ctx(), server())).resolves.toEqual(ok(undefined));
  });

  it('keeps deployment and log behavior behind plugin methods', async () => {
    const plugin = fixturePlugin();
    const deployPlan = await plugin.planDeploy(ctx(), server(), deployment());
    expect(deployPlan.ok).toBe(true);
    if (!deployPlan.ok) return;

    const deployed = await plugin.deployFull(ctx(), server(), deployment(), deployPlan.value);
    expect(deployed.ok).toBe(true);
    expect(await plugin.getLogSources(server())).toEqual(ok({ others: [] }));
  });
});

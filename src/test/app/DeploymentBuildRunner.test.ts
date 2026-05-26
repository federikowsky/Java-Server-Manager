import { describe, expect, it, vi } from 'vitest';
import { HookBackedDeploymentBuildRunner } from '@app/deployment';
import type { DeploymentBuildConfig, DeploymentConfig, OperationContext, ServerConfig } from '@core/types';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

function makeCtx(): OperationContext {
  return {
    operationId: 'op-1',
    serverId: 'srv-1',
    kind: 'DeployFull',
    targetDeploymentId: 'dep-1',
    startedAt: Date.now(),
    timeoutMs: 60_000,
    cancel: { isCancelled: false, onCancelled: () => ({ dispose: () => {} }) },
    progress: { report: () => {} },
    output: { append: vi.fn(), appendLine: vi.fn(), clear: vi.fn() },
  };
}

function makeServer(): ServerConfig {
  return {
    id: 'srv-1',
    name: 'Tomcat',
    type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/opt/tomcat', version: '10.1' },
    instancePath: '/tmp/inst',
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
  };
}

function makeDeployment(build: DeploymentBuildConfig): DeploymentConfig {
  return {
    id: 'dep-1',
    type: 'war',
    sourcePath: '/workspace/app/target/app.war',
    deployName: 'app',
    syncMode: 'manual',
    hotReload: false,
    ignoreGlobs: [],
    build,
    hooks: [],
  };
}

describe('HookBackedDeploymentBuildRunner', () => {
  it('runs explicit command build through the existing hook execution boundary', async () => {
    const hookRunner = {
      runHooks: vi.fn(async () => ok({ executed: 1, skipped: 0, failed: 0, errors: [] })),
    };
    const build: DeploymentBuildConfig = {
      enabled: true,
      kind: 'command',
      trigger: 'manual',
      timeoutMs: 120_000,
      command: { mode: 'shell', line: 'mvn package', cwd: '/workspace/app' },
    };
    const runner = new HookBackedDeploymentBuildRunner({ hookRunner: hookRunner as never });

    const result = await runner.runBuild({
      parent: makeCtx(),
      server: makeServer(),
      deployment: makeDeployment(build),
      build,
    });

    expect(result.ok).toBe(true);
    expect(hookRunner.runHooks).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'pre',
      event: 'deploy.full',
      targetDeploymentId: 'dep-1',
      hooks: [expect.objectContaining({
        id: 'build:dep-1',
        enabled: true,
        kind: 'command',
        timeoutMs: 120_000,
        command: build.command,
      })],
    }));
  });

  it('maps build hook failures to deployment failures with build-specific context', async () => {
    const hookError = new JsmError({ code: ErrorCode.HookFailed, message: 'Hook failed' });
    const hookRunner = {
      runHooks: vi.fn(async () => err(hookError)),
    };
    const build: DeploymentBuildConfig = {
      enabled: true,
      kind: 'command',
      trigger: 'manual',
      timeoutMs: 120_000,
      command: { mode: 'shell', line: 'mvn package' },
    };
    const runner = new HookBackedDeploymentBuildRunner({ hookRunner: hookRunner as never });

    const result = await runner.runBuild({
      parent: makeCtx(),
      server: makeServer(),
      deployment: makeDeployment(build),
      build,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.DeployFailed);
      expect(result.error.message).toContain("Build before deploy failed for 'app'");
      expect(result.error.cause).toBe(hookError);
    }
  });
});

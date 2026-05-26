import type {
  DeploymentBuildConfig,
  DeploymentConfig,
  HookConfig,
  OperationContext,
  ServerConfig,
} from '@core/types';
import type { Result } from '@core/result';
import { err, ok } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { HookRunner } from '@app/hooks';

export interface DeploymentBuildRequest {
  parent: OperationContext;
  server: ServerConfig;
  deployment: DeploymentConfig;
  build: DeploymentBuildConfig;
}

export interface DeploymentBuildRunner {
  runBuild(request: DeploymentBuildRequest): Promise<Result<void, JsmError>>;
}

export class HookBackedDeploymentBuildRunner implements DeploymentBuildRunner {
  private readonly hookRunner: Pick<HookRunner, 'runHooks'>;

  constructor(deps: { hookRunner: Pick<HookRunner, 'runHooks'> }) {
    this.hookRunner = deps.hookRunner;
  }

  async runBuild(request: DeploymentBuildRequest): Promise<Result<void, JsmError>> {
    const hook = this.buildToHook(request);
    request.parent.output.appendLine(`Running build before deploy for '${request.deployment.deployName}'.`);

    const result = await this.hookRunner.runHooks({
      parent: request.parent,
      phase: 'pre',
      event: 'deploy.full',
      hooks: [hook],
      targetDeploymentId: request.deployment.id,
    });

    if (!result.ok) {
      return err(new JsmError({
        code: ErrorCode.DeployFailed,
        message: `Build before deploy failed for '${request.deployment.deployName}': ${result.error.message}`,
        cause: result.error,
      }));
    }

    return ok(undefined);
  }

  private buildToHook(request: DeploymentBuildRequest): HookConfig {
    const { deployment, build } = request;
    const base = {
      id: `build:${deployment.id}`,
      enabled: true,
      phase: 'pre' as const,
      event: 'deploy.full' as const,
      kind: build.kind,
      timeoutMs: build.timeoutMs,
      continueOnError: false,
    };

    if (build.kind === 'vscodeTask') {
      return {
        ...base,
        kind: 'vscodeTask',
        vscodeTask: build.vscodeTask ?? { taskName: '' },
      };
    }

    return {
      ...base,
      kind: 'command',
      command: build.command ?? { mode: 'shell', line: '' },
    };
  }
}

import type {
  HookConfig,
  HookPhase,
  HookEvent,
  DeploymentId,
  Logger,
  OperationContext,
  TrustGate,
} from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { HOOK_PHASE_BUDGET_MS } from '../../constants';

// ── Hook Executor (injected) ────────────────────────────────────────────────

/**
 * Abstraction for running a single hook.
 * Implemented by ui/adapters (command → ProcessSpawner, vscodeTask → tasks.executeTask).
 */
export interface HookExecutionRequest {
  parent: OperationContext;
  phase: HookPhase;
  event: HookEvent;
  hook: HookConfig;
  targetDeploymentId?: DeploymentId;
}

export interface HookExecutor {
  runCommand(request: HookExecutionRequest): Promise<Result<void, JsmError>>;
  runVscodeTask(request: HookExecutionRequest): Promise<Result<void, JsmError>>;
}

// ── Hook Result ─────────────────────────────────────────────────────────────

export interface HookRunResult {
  executed: number;
  skipped: number;
  failed: number;
  errors: JsmError[];
}

export interface HookRunArgs {
  parent: OperationContext;
  phase: HookPhase;
  event: HookEvent;
  hooks: readonly HookConfig[];
  targetDeploymentId?: DeploymentId;
}

/**
 * Config-driven hook execution as a subordinate phase of a parent operation.
 * Enforces per-hook timeout, phase aggregate budget, parent-operation budget,
 * and continueOnError semantics.
 */
export class HookRunner {
  private readonly executor: HookExecutor;
  private readonly logger: Logger;
  private readonly trustGate?: TrustGate;

  constructor(deps: { executor: HookExecutor; logger: Logger; trustGate?: TrustGate }) {
    this.executor = deps.executor;
    this.logger = deps.logger;
    this.trustGate = deps.trustGate;
  }

  /**
   * Run all hooks matching the given phase and event.
   * Merges server-level and deployment-level hooks.
   * Respects `enabled`, `continueOnError`, parent cancellation, and time budgets.
   */
  async runHooks(args: HookRunArgs): Promise<Result<HookRunResult, JsmError>> {
    if (this.trustGate && !this.trustGate.isTrusted()) {
      return err(new JsmError({
        code: ErrorCode.WorkspaceUntrusted,
        message: 'Hooks are disabled in untrusted workspaces.',
      }));
    }

    const { parent, phase, event } = args;
    const matching = args.hooks.filter(h => h.enabled && h.phase === phase && h.event === event);

    const result: HookRunResult = {
      executed: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    if (matching.length === 0) {
      return ok(result);
    }

    const phaseStart = Date.now();

    for (let index = 0; index < matching.length; index++) {
      const hook = matching[index];
      const remainingHooks = matching.length - index;

      if (parent.cancel.isCancelled) {
        this.logger.info(
          `HookRunner[${parent.serverId}]: parent operation '${parent.kind}' cancelled, skipping remaining hooks for ${event}`,
        );
        parent.output.appendLine(`Skipping ${remainingHooks} hook(s) for ${event}: parent operation cancelled.`);
        result.skipped += remainingHooks;
        break;
      }

      const elapsed = Date.now() - phaseStart;
      const remainingPhaseBudget = HOOK_PHASE_BUDGET_MS - elapsed;
      if (remainingPhaseBudget <= 0) {
        this.logger.warn(
          `HookRunner[${parent.serverId}]: phase budget exceeded (${elapsed}ms >= ${HOOK_PHASE_BUDGET_MS}ms), skipping remaining hooks`,
        );
        parent.output.appendLine(`Skipping ${remainingHooks} hook(s) for ${event}: phase budget exceeded.`);
        result.skipped += remainingHooks;
        break;
      }

      const remainingParentBudget = this.remainingParentBudgetMs(parent);
      const requestedTimeoutMs = hook.timeoutMs || 60_000;
      const effectiveTimeoutMs = Math.min(
        requestedTimeoutMs,
        remainingPhaseBudget,
        remainingParentBudget,
      );

      if (effectiveTimeoutMs <= 0) {
        const timeoutError = new JsmError({
          code: ErrorCode.Timeout,
          message: `Hook '${hook.id}' timed out before it could start within the parent operation budget`,
        });
        return this.handleHookFailure(result, matching.length, index, hook, timeoutError);
      }

      parent.output.appendLine(`Running hook '${hook.id}' (${phase} ${event})`);
      const hookResult = await this.executeOneHook({
        parent,
        phase,
        event,
        hook,
        targetDeploymentId: args.targetDeploymentId ?? parent.targetDeploymentId,
      }, effectiveTimeoutMs);

      if (hookResult.ok) {
        result.executed++;
      } else {
        parent.output.appendLine(`Hook '${hook.id}' failed: ${hookResult.error.message}`);
        const failure = this.handleHookFailure(result, matching.length, index, hook, hookResult.error);
        if (!failure.ok) {
          return failure;
        }
      }
    }

    return ok(result);
  }

  /**
   * Execute a single hook with its per-hook timeout.
   */
  private async executeOneHook(
    request: HookExecutionRequest,
    timeoutMs: number,
  ): Promise<Result<void, JsmError>> {
    try {
      const resultPromise =
        request.hook.kind === 'command'
          ? this.executor.runCommand(request)
          : this.executor.runVscodeTask(request);

      const result = await Promise.race([
        resultPromise,
        this.timeoutPromise(timeoutMs, request.hook.id),
      ]);

      return result;
    } catch (cause) {
      return err(cause instanceof JsmError ? cause : JsmError.fromUnknown(cause));
    }
  }

  private handleHookFailure(
    result: HookRunResult,
    totalHooks: number,
    index: number,
    hook: HookConfig,
    error: JsmError,
  ): Result<HookRunResult, JsmError> {
    result.failed++;
    result.errors.push(error);
    this.logger.warn(`HookRunner: hook '${hook.id}' failed`, error);

    if (hook.continueOnError) {
      return ok(result);
    }

    result.skipped += totalHooks - index - 1;
    return err(new JsmError({
      code: ErrorCode.HookFailed,
      message: `Hook '${hook.id}' failed and continueOnError is false`,
      cause: error,
    }));
  }

  private remainingParentBudgetMs(parent: OperationContext): number {
    return Math.max(0, parent.timeoutMs - (Date.now() - parent.startedAt));
  }

  private timeoutPromise(ms: number, hookId: string): Promise<Result<void, JsmError>> {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(err(new JsmError({
          code: ErrorCode.Timeout,
          message: `Hook '${hookId}' timed out after ${ms}ms`,
        })));
      }, ms);
    });
  }
}

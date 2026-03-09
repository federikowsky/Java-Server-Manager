import type {
  HookConfig,
  HookPhase,
  HookEvent,
  ServerId,
  Logger,
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
export interface HookExecutor {
  runCommand(hook: HookConfig): Promise<Result<void, JsmError>>;
  runVscodeTask(hook: HookConfig): Promise<Result<void, JsmError>>;
}

// ── Hook Result ─────────────────────────────────────────────────────────────

export interface HookRunResult {
  executed: number;
  skipped: number;
  failed: number;
  errors: JsmError[];
}

/**
 * Config-driven hook execution (§10.6).
 * Enforces per-hook timeout, phase aggregate budget (120s), and continueOnError.
 */
export class HookRunner {
  private readonly executor: HookExecutor;
  private readonly logger: Logger;

  constructor(deps: { executor: HookExecutor; logger: Logger }) {
    this.executor = deps.executor;
    this.logger = deps.logger;
  }

  /**
   * Run all hooks matching the given phase and event.
   * Merges server-level and deployment-level hooks.
   * Respects `enabled`, `continueOnError`, and phase budget.
   */
  async runHooks(
    serverId: ServerId,
    phase: HookPhase,
    event: HookEvent,
    hooks: readonly HookConfig[],
  ): Promise<Result<HookRunResult, JsmError>> {
    const matching = hooks.filter(h => h.enabled && h.phase === phase && h.event === event);

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

    for (const hook of matching) {
      // Check phase budget (§10.6: 120s aggregate)
      const elapsed = Date.now() - phaseStart;
      if (elapsed >= HOOK_PHASE_BUDGET_MS) {
        this.logger.warn(
          `HookRunner[${serverId}]: phase budget exceeded (${elapsed}ms >= ${HOOK_PHASE_BUDGET_MS}ms), skipping remaining hooks`,
        );
        result.skipped += matching.length - result.executed - result.failed;
        break;
      }

      const hookResult = await this.executeOneHook(hook);

      if (hookResult.ok) {
        result.executed++;
      } else {
        result.failed++;
        result.errors.push(hookResult.error);
        this.logger.warn(`HookRunner[${serverId}]: hook '${hook.id}' failed`, hookResult.error);

        if (!hook.continueOnError) {
          // Remaining hooks are skipped
          const remaining = matching.length - result.executed - result.failed;
          result.skipped += remaining;
          return err(new JsmError({
            code: ErrorCode.HookFailed,
            message: `Hook '${hook.id}' failed and continueOnError is false`,
            cause: hookResult.error,
          }));
        }
      }
    }

    return ok(result);
  }

  /**
   * Execute a single hook with its per-hook timeout.
   */
  private async executeOneHook(hook: HookConfig): Promise<Result<void, JsmError>> {
    const timeoutMs = hook.timeoutMs || 60_000;

    try {
      const resultPromise =
        hook.kind === 'command'
          ? this.executor.runCommand(hook)
          : this.executor.runVscodeTask(hook);

      const result = await Promise.race([
        resultPromise,
        this.timeoutPromise(timeoutMs, hook.id),
      ]);

      return result;
    } catch (cause) {
      return err(cause instanceof JsmError ? cause : JsmError.fromUnknown(cause));
    }
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

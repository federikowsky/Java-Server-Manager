import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookRunner, type HookExecutor } from '@app/hooks/HookRunner';
import type { Logger } from '@core/types/logger';
import type { HookConfig } from '@core/types/domain';
import type { OperationContext } from '@core/types';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeHook(overrides: Partial<HookConfig> = {}): HookConfig {
  return {
    id: 'hook-1',
    enabled: true,
    phase: 'pre',
    event: 'lifecycle.start',
    kind: 'command',
    timeoutMs: 60_000,
    continueOnError: false,
    command: { mode: 'shell', line: 'echo hello' },
    ...overrides,
  };
}

function makeParent(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    operationId: 'op-1',
    serverId: 's1',
    kind: 'LifecycleStart',
    startedAt: Date.now(),
    timeoutMs: 60_000,
    cancel: {
      isCancelled: false,
      onCancelled: () => ({ dispose: () => {} }),
    },
    progress: { report: vi.fn() },
    output: {
      append: vi.fn(),
      appendLine: vi.fn(),
      clear: vi.fn(),
    },
    ...overrides,
  };
}

describe('HookRunner', () => {
  let executor: HookExecutor;
  let runner: HookRunner;

  beforeEach(() => {
    executor = {
      runCommand: vi.fn().mockResolvedValue(ok(undefined)),
      runVscodeTask: vi.fn().mockResolvedValue(ok(undefined)),
    };
    runner = new HookRunner({ executor, logger: mockLogger() });
  });

  it('runs matching hooks and returns count', async () => {
    const hooks = [makeHook()];
    const result = await runner.runHooks({
      parent: makeParent(),
      phase: 'pre',
      event: 'lifecycle.start',
      hooks,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.executed).toBe(1);
      expect(result.value.failed).toBe(0);
      expect(result.value.skipped).toBe(0);
    }
    expect(executor.runCommand).toHaveBeenCalledOnce();
  });

  it('skips disabled hooks', async () => {
    const hooks = [makeHook({ enabled: false })];
    const result = await runner.runHooks({
      parent: makeParent(),
      phase: 'pre',
      event: 'lifecycle.start',
      hooks,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.executed).toBe(0);
    }
    expect(executor.runCommand).not.toHaveBeenCalled();
  });

  it('skips hooks with non-matching phase or event', async () => {
    const hooks = [
      makeHook({ phase: 'post' }),
      makeHook({ event: 'lifecycle.stop' }),
    ];
    const result = await runner.runHooks({
      parent: makeParent(),
      phase: 'pre',
      event: 'lifecycle.start',
      hooks,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.executed).toBe(0);
    }
  });

  it('returns error and skips remaining when continueOnError is false', async () => {
    (executor.runCommand as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new JsmError({ code: ErrorCode.HookFailed, message: 'fail' })),
    );
    const hooks = [
      makeHook({ id: 'h1' }),
      makeHook({ id: 'h2' }),
    ];

    const result = await runner.runHooks({
      parent: makeParent(),
      phase: 'pre',
      event: 'lifecycle.start',
      hooks,
    });
    expect(result.ok).toBe(false);
    // Only the first hook should have been attempted
    expect(executor.runCommand).toHaveBeenCalledOnce();
  });

  it('continues on error when continueOnError is true', async () => {
    (executor.runCommand as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(err(new JsmError({ code: ErrorCode.HookFailed, message: 'fail' })))
      .mockResolvedValueOnce(ok(undefined));

    const hooks = [
      makeHook({ id: 'h1', continueOnError: true }),
      makeHook({ id: 'h2', continueOnError: true }),
    ];

    const result = await runner.runHooks({
      parent: makeParent(),
      phase: 'pre',
      event: 'lifecycle.start',
      hooks,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.executed).toBe(1);
      expect(result.value.failed).toBe(1);
      expect(result.value.errors).toHaveLength(1);
    }
    expect(executor.runCommand).toHaveBeenCalledTimes(2);
  });

  it('uses vscodeTask executor for vscodeTask kind', async () => {
    const hooks = [makeHook({ kind: 'vscodeTask', vscodeTask: { taskName: 'build' } })];
    await runner.runHooks({
      parent: makeParent(),
      phase: 'pre',
      event: 'lifecycle.start',
      hooks,
    });
    expect(executor.runVscodeTask).toHaveBeenCalledOnce();
    expect(executor.runCommand).not.toHaveBeenCalled();
  });

  it('clamps hook timeout to the remaining parent operation budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T00:00:00Z'));
    executor.runCommand = vi.fn().mockImplementation(
      async () => new Promise<Result<void, JsmError>>(() => {}),
    );
    runner = new HookRunner({ executor, logger: mockLogger() });

    const promise = runner.runHooks({
      parent: makeParent({
        startedAt: Date.now(),
        timeoutMs: 10,
      }),
      phase: 'pre',
      event: 'lifecycle.start',
      hooks: [makeHook({ timeoutMs: 60_000 })],
    });

    await vi.advanceTimersByTimeAsync(11);
    const result = await promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.HookFailed);
      expect(result.error.cause).toBeInstanceOf(JsmError);
      expect((result.error.cause as JsmError).code).toBe(ErrorCode.Timeout);
    }

    vi.useRealTimers();
  });

  it('skips remaining hooks when parent operation is already cancelled', async () => {
    const result = await runner.runHooks({
      parent: makeParent({
        cancel: {
          isCancelled: true,
          onCancelled: () => ({ dispose: () => {} }),
        },
      }),
      phase: 'pre',
      event: 'lifecycle.start',
      hooks: [makeHook(), makeHook({ id: 'hook-2' })],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.executed).toBe(0);
      expect(result.value.failed).toBe(0);
      expect(result.value.skipped).toBe(2);
    }
    expect(executor.runCommand).not.toHaveBeenCalled();
  });

  describe('TrustGate (§12.8)', () => {
    it('blocks hooks in untrusted workspace', async () => {
      const untrustedRunner = new HookRunner({
        executor,
        logger: mockLogger(),
        trustGate: { isTrusted: () => false },
      });
      const hooks = [makeHook()];
      const result = await untrustedRunner.runHooks({
        parent: makeParent(),
        phase: 'pre',
        event: 'lifecycle.start',
        hooks,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
      expect(executor.runCommand).not.toHaveBeenCalled();
    });
  });
});

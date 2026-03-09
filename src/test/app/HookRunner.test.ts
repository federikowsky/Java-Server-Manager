import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookRunner, type HookExecutor } from '@app/hooks/HookRunner';
import type { Logger } from '@core/types/logger';
import type { HookConfig } from '@core/types/domain';
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
    command: { exe: '/bin/echo', args: ['hello'] },
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
    const result = await runner.runHooks('s1', 'pre', 'lifecycle.start', hooks);
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
    const result = await runner.runHooks('s1', 'pre', 'lifecycle.start', hooks);
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
    const result = await runner.runHooks('s1', 'pre', 'lifecycle.start', hooks);
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

    const result = await runner.runHooks('s1', 'pre', 'lifecycle.start', hooks);
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

    const result = await runner.runHooks('s1', 'pre', 'lifecycle.start', hooks);
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
    await runner.runHooks('s1', 'pre', 'lifecycle.start', hooks);
    expect(executor.runVscodeTask).toHaveBeenCalledOnce();
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
      const result = await untrustedRunner.runHooks('s1', 'pre', 'lifecycle.start', hooks);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(ErrorCode.WorkspaceUntrusted);
      expect(executor.runCommand).not.toHaveBeenCalled();
    });
  });
});

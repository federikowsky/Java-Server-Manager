/**
 * APP-HOOK-003: Per-hook Promise.race timeout — slow executor returns hook failure without hanging runHooks forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HookRunner, type HookExecutor } from '@app/hooks/HookRunner';
import type { Logger } from '@core/types/logger';
import type { HookConfig } from '@core/types/domain';
import type { OperationContext } from '@core/types';
import { ok } from '@core/result';
import { ErrorCode } from '@core/errors/codes';
import { JsmError } from '@core/errors/JsmError';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeHook(overrides: Partial<HookConfig> = {}): HookConfig {
  return {
    id: 'hook-slow',
    enabled: true,
    phase: 'pre',
    event: 'lifecycle.start',
    kind: 'command',
    timeoutMs: 20,
    continueOnError: false,
    command: { mode: 'shell', line: 'sleep 999' },
    ...overrides,
  };
}

function makeParent(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    operationId: 'op-1',
    serverId: 's1',
    kind: 'LifecycleStart',
    startedAt: Date.now(),
    timeoutMs: 120_000,
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

describe('HookRunner per-hook timeout (extended)', () => {
  let executor: HookExecutor;
  let runner: HookRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    executor = {
      runCommand: vi.fn(() => new Promise(() => {})),
      runVscodeTask: vi.fn().mockResolvedValue(ok(undefined)),
    };
    runner = new HookRunner({ executor, logger: mockLogger() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('APP-HOOK-003: hook exceeding timeoutMs yields failed hook result', async () => {
    const hooksPromise = runner.runHooks({
      parent: makeParent(),
      phase: 'pre',
      event: 'lifecycle.start',
      hooks: [makeHook({ timeoutMs: 100 })],
    });

    await vi.advanceTimersByTimeAsync(150);
    const result = await hooksPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.HookFailed);
      const cause = result.error.cause;
      expect(cause).toBeInstanceOf(JsmError);
      if (cause instanceof JsmError) {
        expect(cause.code).toBe(ErrorCode.Timeout);
        expect(cause.message).toMatch(/timed out/i);
      }
    }
    expect(executor.runCommand).toHaveBeenCalledOnce();
  });
});

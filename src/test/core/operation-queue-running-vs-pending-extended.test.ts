/**
 * CORE-009: While one op is executing (await inside executor), another can be enqueued
 * and must run after the first completes. Uses setTimeout yield like operation-queue.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { OperationQueue } from '@core/ops/OperationQueue';
import type { Logger } from '@core/types/logger';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('OperationQueue running vs pending (extended)', () => {
  it('CORE-009: second op enqueued while first is blocked still executes after first', async () => {
    const q = new OperationQueue('s1', mockLogger());
    const executed: string[] = [];
    let unblock: (() => void) | undefined;

    q.setExecutor(async (e) => {
      if (e.kind === 'DeployIncremental' && executed.length === 0) {
        await new Promise<void>(resolve => {
          unblock = resolve;
        });
      }
      executed.push(`${e.kind}:${e.targetDeploymentId ?? ''}`);
    });

    q.enqueue({ kind: 'DeployIncremental', targetDeploymentId: 'd1' });
    await new Promise(r => setTimeout(r, 10));
    expect(unblock).toBeDefined();
    expect(q.isRunning).toBe(true);

    q.enqueue({ kind: 'DeployIncremental', targetDeploymentId: 'd2' });
    expect(q.size).toBe(1);

    unblock!();
    await new Promise(r => setTimeout(r, 50));

    expect(executed).toEqual(['DeployIncremental:d1', 'DeployIncremental:d2']);
  });
});

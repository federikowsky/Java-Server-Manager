import { describe, it, expect, vi } from 'vitest';
import { OperationQueue, type QueueEntry, type Executor } from '@core/ops/OperationQueue';
import type { Logger } from '@core/types/logger';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function entry(kind: QueueEntry['kind'], dep?: string): QueueEntry {
  return { kind, targetDeploymentId: dep };
}

async function collectExecutionOrder(queue: OperationQueue, entries: QueueEntry[]): Promise<string[]> {
  const order: string[] = [];
  queue.setExecutor(async (e) => {
    order.push(e.kind + (e.targetDeploymentId ? `(${e.targetDeploymentId})` : ''));
  });
  for (const e of entries) queue.enqueue(e);
  // Wait for drain
  await new Promise(r => setTimeout(r, 50));
  return order;
}

describe('OperationQueue', () => {
  it('executes entries in FIFO order at same priority', async () => {
    const q = new OperationQueue('s1', mockLogger());
    const order = await collectExecutionOrder(q, [
      entry('DeployFull', 'd1'),
      entry('DeployIncremental', 'd2'),
    ]);
    expect(order).toEqual(['DeployFull(d1)', 'DeployIncremental(d2)']);
  });

  it('inserts higher-priority ops before lower-priority pending ones', async () => {
    const q = new OperationQueue('s1', mockLogger());
    const order: string[] = [];
    let resolve: (() => void) | undefined;
    const blocking = new Promise<void>(r => { resolve = r; });

    q.setExecutor(async (e) => {
      order.push(e.kind);
      if (e.kind === 'DeployFull') await blocking;
    });

    // First entry starts executing and blocks
    q.enqueue(entry('DeployFull', 'd1'));
    // Wait for it to start
    await new Promise(r => setTimeout(r, 10));

    // Queue low-priority then high-priority
    q.enqueue(entry('StatusRefresh'));
    q.enqueue(entry('LifecycleStop'));

    resolve!();
    await new Promise(r => setTimeout(r, 50));
    // LifecycleStop (priority 1) should execute before StatusRefresh (priority 3)
    expect(order).toEqual(['DeployFull', 'LifecycleStop', 'StatusRefresh']);
  });

  it('coalesces StatusRefresh (keep-last)', async () => {
    const q = new OperationQueue('s1', mockLogger());
    let resolve: (() => void) | undefined;
    const blocking = new Promise<void>(r => { resolve = r; });
    const order: string[] = [];

    q.setExecutor(async (e) => {
      order.push(e.kind);
      if (order.length === 1) await blocking;
    });

    q.enqueue(entry('StatusRefresh'));
    await new Promise(r => setTimeout(r, 10));
    q.enqueue(entry('StatusRefresh'));
    q.enqueue(entry('StatusRefresh'));

    resolve!();
    await new Promise(r => setTimeout(r, 50));
    // First runs immediately, then only one coalesced refresh remains
    expect(order).toEqual(['StatusRefresh', 'StatusRefresh']);
  });

  it('drops DeployIncremental when DeployFull pending for same deployment', async () => {
    const q = new OperationQueue('s1', mockLogger());
    let resolve: (() => void) | undefined;
    const blocking = new Promise<void>(r => { resolve = r; });
    const order: string[] = [];

    q.setExecutor(async (e) => {
      order.push(e.kind + (e.targetDeploymentId ? `(${e.targetDeploymentId})` : ''));
      if (order.length === 1) await blocking;
    });

    q.enqueue(entry('LifecycleStart'));
    await new Promise(r => setTimeout(r, 10));
    q.enqueue(entry('DeployFull', 'd1'));
    q.enqueue(entry('DeployIncremental', 'd1')); // Should be dropped

    resolve!();
    await new Promise(r => setTimeout(r, 50));
    expect(order).toEqual(['LifecycleStart', 'DeployFull(d1)']);
  });

  it('clear() removes all pending operations', async () => {
    const q = new OperationQueue('s1', mockLogger());
    const order: string[] = [];
    let resolve: (() => void) | undefined;
    const blocking = new Promise<void>(r => { resolve = r; });

    q.setExecutor(async (e) => {
      order.push(e.kind);
      if (order.length === 1) await blocking;
    });

    q.enqueue(entry('LifecycleStart'));
    await new Promise(r => setTimeout(r, 10));
    q.enqueue(entry('DeployFull', 'd1'));
    q.enqueue(entry('StatusRefresh'));
    q.clear();

    resolve!();
    await new Promise(r => setTimeout(r, 50));
    // Only the first (already running) op executes; the rest were cleared
    expect(order).toEqual(['LifecycleStart']);
  });

  it('reports isRunning and size correctly', async () => {
    const q = new OperationQueue('s1', mockLogger());
    expect(q.isRunning).toBe(false);
    expect(q.size).toBe(0);
  });
});

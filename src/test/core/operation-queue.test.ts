import { describe, it, expect, vi } from 'vitest';
import {
  OperationQueue,
  QUEUE_META_FILE_CHANGE_BATCH,
  type QueueEntry,
  type Executor,
} from '@core/ops/OperationQueue';
import type { Logger } from '@core/types/logger';
import type { FileChangeBatch } from '@core/types';

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

  it('coalesces DeploySync for same deployment to a single pending entry', async () => {
    const q = new OperationQueue('s1', mockLogger());
    let resolve: (() => void) | undefined;
    const blocking = new Promise<void>(r => { resolve = r; });
    const order: string[] = [];
    let lastDeploySyncBatch: FileChangeBatch | undefined;

    q.setExecutor(async (e) => {
      order.push(e.kind + (e.targetDeploymentId ? `(${e.targetDeploymentId})` : ''));
      if (e.kind === 'DeploySync') {
        lastDeploySyncBatch = e.meta?.[QUEUE_META_FILE_CHANGE_BATCH] as FileChangeBatch;
      }
      if (order.length === 1) await blocking;
    });

    q.enqueue(entry('LifecycleStart'));
    await new Promise(r => setTimeout(r, 10));
    q.enqueue({
      kind: 'DeploySync',
      targetDeploymentId: 'd1',
      meta: {
        [QUEUE_META_FILE_CHANGE_BATCH]: {
          changes: [{ type: 'change', path: '/a', relativePath: 'a' }],
          totalFiles: 1,
          totalBytes: 1,
        },
      },
    });
    q.enqueue({
      kind: 'DeploySync',
      targetDeploymentId: 'd1',
      meta: {
        [QUEUE_META_FILE_CHANGE_BATCH]: {
          changes: [{ type: 'change', path: '/b', relativePath: 'b' }],
          totalFiles: 1,
          totalBytes: 1,
        },
      },
    });

    resolve!();
    await new Promise(r => setTimeout(r, 50));
    expect(order).toEqual(['LifecycleStart', 'DeploySync(d1)']);
    const rels = (lastDeploySyncBatch?.changes ?? []).map(c => c.relativePath).sort();
    expect(rels).toEqual(['a', 'b']);
    expect(lastDeploySyncBatch?.totalFiles).toBe(2);
  });

  it('coalesced DeploySync keeps newer change when relativePath matches', async () => {
    const q = new OperationQueue('s1', mockLogger());
    let resolve: (() => void) | undefined;
    const blocking = new Promise<void>(r => { resolve = r; });
    let lastBatch: { changes: Array<{ type: string; relativePath: string }> } | undefined;

    q.setExecutor(async (e) => {
      if (e.kind === 'DeploySync') {
        lastBatch = e.meta?.[QUEUE_META_FILE_CHANGE_BATCH] as typeof lastBatch;
      }
      if (e.kind === 'LifecycleStart') await blocking;
    });

    q.enqueue(entry('LifecycleStart'));
    await new Promise(r => setTimeout(r, 10));
    q.enqueue({
      kind: 'DeploySync',
      targetDeploymentId: 'd1',
      meta: {
        [QUEUE_META_FILE_CHANGE_BATCH]: {
          changes: [{ type: 'change', path: '/x', relativePath: 'src/Foo.java' }],
          totalFiles: 1,
          totalBytes: 1,
        },
      },
    });
    q.enqueue({
      kind: 'DeploySync',
      targetDeploymentId: 'd1',
      meta: {
        [QUEUE_META_FILE_CHANGE_BATCH]: {
          changes: [{ type: 'delete', path: '/x', relativePath: 'src/Foo.java' }],
          totalFiles: 1,
          totalBytes: 0,
        },
      },
    });

    resolve!();
    await new Promise(r => setTimeout(r, 50));
    expect(lastBatch?.changes).toHaveLength(1);
    expect(lastBatch?.changes[0]?.type).toBe('delete');
    expect(lastBatch?.changes[0]?.relativePath).toBe('src/Foo.java');
  });

  it('does not merge DeploySync batches across different deployments', async () => {
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
    q.enqueue({
      kind: 'DeploySync',
      targetDeploymentId: 'd1',
      meta: {
        [QUEUE_META_FILE_CHANGE_BATCH]: {
          changes: [{ type: 'change', path: '/a', relativePath: 'a' }],
          totalFiles: 1,
          totalBytes: 1,
        },
      },
    });
    q.enqueue({
      kind: 'DeploySync',
      targetDeploymentId: 'd2',
      meta: {
        [QUEUE_META_FILE_CHANGE_BATCH]: {
          changes: [{ type: 'change', path: '/z', relativePath: 'z' }],
          totalFiles: 1,
          totalBytes: 1,
        },
      },
    });

    resolve!();
    await new Promise(r => setTimeout(r, 50));
    expect(order).toEqual(['LifecycleStart', 'DeploySync(d1)', 'DeploySync(d2)']);
  });

  it('drops DeploySync when DeployFull is pending for same deployment', async () => {
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
    q.enqueue({
      kind: 'DeploySync',
      targetDeploymentId: 'd1',
      meta: {
        [QUEUE_META_FILE_CHANGE_BATCH]: {
          changes: [],
          totalFiles: 0,
          totalBytes: 0,
        },
      },
    });

    resolve!();
    await new Promise(r => setTimeout(r, 50));
    expect(order).toEqual(['LifecycleStart', 'DeployFull(d1)']);
  });
});

import type { ServerId, DeploymentId, OperationKind, FileChange, FileChangeBatch } from '../types';
import type { Logger } from '../types/logger';

/** `QueueEntry.meta` key for `DeploySync` — value is `FileChangeBatch`. */
export const QUEUE_META_FILE_CHANGE_BATCH = 'fileChangeBatch';

// ── Priority Map (§9.4) ────────────────────────────────────────────────────

const PRIORITY: Record<OperationKind, number> = {
  LifecycleStop:      1,
  LifecycleRestart:   2,
  LifecycleStart:     2,
  DeployFull:         3,
  DeployRollback:     3,
  DeployIncremental:  3,
  DeploySync:         3,
  DeployHotReload:    3,
  SyncAll:            3,
  RedeployAll:        3,
  Undeploy:           3,
  DeployUndeployed:   3,
  RunDeploymentHealthChecks: 3,
  StatusRefresh:      3,
};

// ── Queue Entry ─────────────────────────────────────────────────────────────

export interface QueueEntry {
  kind: OperationKind;
  targetDeploymentId?: DeploymentId;
  /** Opaque payload forwarded to the executor. */
  meta?: Record<string, unknown>;
}

// ── Coalescing (§9.3) ──────────────────────────────────────────────────────

type CoalesceAction = 'queue' | 'drop' | 'replace' | 'keep-last';

function sameDeployment(a?: DeploymentId, b?: DeploymentId): boolean {
  return a !== undefined && a === b;
}

/** Kinds that may carry {@link QUEUE_META_FILE_CHANGE_BATCH} when coalesced with keep-last. */
const BATCH_COALESCING_KINDS = new Set<OperationKind>(['DeploySync', 'DeployIncremental']);

function fileChangeBatchDedupeKey(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}

function parseFileChangeBatch(meta: Record<string, unknown> | undefined): FileChangeBatch | undefined {
  if (!meta) return undefined;
  const raw = meta[QUEUE_META_FILE_CHANGE_BATCH];
  if (!raw || typeof raw !== 'object') return undefined;
  const changes = (raw as FileChangeBatch).changes;
  if (!Array.isArray(changes)) return undefined;
  return raw as FileChangeBatch;
}

/**
 * Merge older + newer batches: same logical path (normalized slashes) keeps the newer change.
 * Totals are recomputed from merged changes.
 */
function mergeTwoFileChangeBatches(
  older: FileChangeBatch | undefined,
  newer: FileChangeBatch | undefined,
): FileChangeBatch {
  const olderC = older?.changes ?? [];
  const newerC = newer?.changes ?? [];
  const byKey = new Map<string, FileChange>();
  for (const ch of olderC) {
    if (ch && typeof ch.relativePath === 'string') {
      byKey.set(fileChangeBatchDedupeKey(ch.relativePath), ch);
    }
  }
  for (const ch of newerC) {
    if (ch && typeof ch.relativePath === 'string') {
      byKey.set(fileChangeBatchDedupeKey(ch.relativePath), ch);
    }
  }
  const changes = Array.from(byKey.values());
  let totalBytes = 0;
  for (const ch of changes) {
    totalBytes += ch.sizeBytes ?? 0;
  }
  return { changes, totalFiles: changes.length, totalBytes };
}

/**
 * When keep-last drops a pending DeploySync/DeployIncremental, preserve its file batch in the survivor.
 */
function mergeQueuedFileChangeBatchesOnKeepLast(existing: QueueEntry, incoming: QueueEntry): void {
  if (!sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return;
  }
  if (!BATCH_COALESCING_KINDS.has(existing.kind) || !BATCH_COALESCING_KINDS.has(incoming.kind)) {
    return;
  }
  const oldBatch = parseFileChangeBatch(existing.meta);
  const newBatch = parseFileChangeBatch(incoming.meta);
  if (!oldBatch && !newBatch) {
    return;
  }
  const merged = mergeTwoFileChangeBatches(oldBatch, newBatch);
  incoming.meta = { ...incoming.meta, [QUEUE_META_FILE_CHANGE_BATCH]: merged };
}

/**
 * Decide what to do when `incoming` is submitted while `existing` is
 * already pending (or active for lifecycle coalescing).
 */
function coalesce(existing: QueueEntry, incoming: QueueEntry): CoalesceAction {
  const ek = existing.kind;
  const ik = incoming.kind;

  // StatusRefresh + StatusRefresh → keep last only
  if (ek === 'StatusRefresh' && ik === 'StatusRefresh') return 'keep-last';

  // DeployIncremental(dep) + DeployIncremental(dep) → keep last
  if (ek === 'DeployIncremental' && ik === 'DeployIncremental') {
    return sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)
      ? 'keep-last'
      : 'queue';
  }

  // DeploySync(dep) + DeploySync(dep) → keep last (autosync coalescing)
  if (ek === 'DeploySync' && ik === 'DeploySync') {
    return sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)
      ? 'keep-last'
      : 'queue';
  }

  // DeploySync ↔ DeployIncremental same dep → keep last (same autosync family)
  if (
    (ek === 'DeploySync' && ik === 'DeployIncremental' ||
      ek === 'DeployIncremental' && ik === 'DeploySync') &&
    sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)
  ) {
    return 'keep-last';
  }

  // DeployHotReload(dep) + DeployHotReload(dep) → keep last
  if (ek === 'DeployHotReload' && ik === 'DeployHotReload') {
    return sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)
      ? 'keep-last'
      : 'queue';
  }

  // DeployHotReload(dep) + DeployIncremental(dep) → keep last (hot-reload overrides incremental)
  if (ek === 'DeployHotReload' && ik === 'DeployIncremental' &&
      sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return 'keep-last';
  }

  // DeployIncremental(dep) + DeployHotReload(dep) → replace with hot-reload
  if (ek === 'DeployIncremental' && ik === 'DeployHotReload' &&
      sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return 'replace';
  }

  // DeployHotReload(dep) + DeploySync(dep) → keep last
  if (ek === 'DeployHotReload' && ik === 'DeploySync' &&
      sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return 'keep-last';
  }

  // DeploySync(dep) + DeployHotReload(dep) → replace with hot-reload
  if (ek === 'DeploySync' && ik === 'DeployHotReload' &&
      sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return 'replace';
  }

  // DeployHotReload(dep) + DeployFull(dep) → replace with full
  if (ek === 'DeployHotReload' && ik === 'DeployFull' &&
      sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return 'replace';
  }

  // DeployFull(dep) + DeployHotReload(dep) → drop (full overrides hot-reload)
  if (ek === 'DeployFull' && ik === 'DeployHotReload' &&
      sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return 'drop';
  }

  // DeployFull(dep) + DeployIncremental(dep) → drop new
  if (ek === 'DeployFull' && ik === 'DeployIncremental' &&
      sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return 'drop';
  }

  // DeployIncremental(dep) + DeployFull(dep) → replace with full
  if (ek === 'DeployIncremental' && ik === 'DeployFull' &&
      sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return 'replace';
  }

  // DeployFull(dep) + DeploySync(dep) → drop incoming sync (explicit full wins)
  if (ek === 'DeployFull' && ik === 'DeploySync' &&
      sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return 'drop';
  }

  // DeploySync(dep) + DeployFull(dep) → replace pending sync with full
  if (ek === 'DeploySync' && ik === 'DeployFull' &&
      sameDeployment(existing.targetDeploymentId, incoming.targetDeploymentId)) {
    return 'replace';
  }

  // SyncAll + DeployIncremental(any) → drop
  if (ek === 'SyncAll' && ik === 'DeployIncremental') return 'drop';

  // SyncAll + DeploySync(any) → drop
  if (ek === 'SyncAll' && ik === 'DeploySync') return 'drop';

  // SyncAll + DeployFull(any) → queue (explicit full takes precedence)
  if (ek === 'SyncAll' && ik === 'DeployFull') return 'queue';

  // DeployIncremental(any) + SyncAll → replace pending incrementals
  if (ek === 'DeployIncremental' && ik === 'SyncAll') return 'replace';

  // DeploySync(any) + SyncAll → replace pending sync
  if (ek === 'DeploySync' && ik === 'SyncAll') return 'replace';

  // RedeployAll + DeployFull/SyncAll/DeploySync → drop
  if (ek === 'RedeployAll' && (ik === 'DeployFull' || ik === 'SyncAll' || ik === 'DeploySync')) {
    return 'drop';
  }

  // DeployFull/SyncAll/DeploySync + RedeployAll → replace
  if ((ek === 'DeployFull' || ek === 'SyncAll' || ek === 'DeploySync') && ik === 'RedeployAll') {
    return 'replace';
  }

  // Lifecycle start + same start → ignore (drop)
  if (ek === 'LifecycleStart' && ik === 'LifecycleStart') {
    // Different modes are encoded in meta; if both exists, replace
    return 'replace';
  }

  return 'queue';
}

// ── OperationQueue ──────────────────────────────────────────────────────────

export type Executor = (entry: QueueEntry) => Promise<void>;

/**
 * Priority-FIFO operation queue for a single server (§9.2).
 *
 * - One active operation at a time.
 * - Higher-priority entries are inserted before lower-priority pending ones.
 * - Coalescing rules (§9.3) apply when enqueueing.
 */
export class OperationQueue {
  readonly serverId: ServerId;
  private readonly logger: Logger;
  private readonly pending: QueueEntry[] = [];
  private running: QueueEntry | null = null;
  private executor: Executor | null = null;
  private draining = false;
  private readonly idleWaiters: Array<() => void> = [];
  /** First executor error in the current drain pass; cleared when read after idle. */
  private drainFailure: unknown = undefined;

  constructor(serverId: ServerId, logger: Logger) {
    this.serverId = serverId;
    this.logger = logger;
  }

  /** Set the function that actually executes an operation. */
  setExecutor(fn: Executor): void {
    this.executor = fn;
  }

  /** Enqueue an operation, applying coalescing and priority insertion. */
  enqueue(entry: QueueEntry): void {
    // Apply coalescing against pending entries
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const action = coalesce(this.pending[i], entry);
      switch (action) {
        case 'drop':
          this.logger.debug(`Queue[${this.serverId}]: dropping ${entry.kind} (coalesced with pending ${this.pending[i].kind})`);
          return;
        case 'replace':
          this.logger.debug(`Queue[${this.serverId}]: replacing pending ${this.pending[i].kind} with ${entry.kind}`);
          this.pending.splice(i, 1);
          break;
        case 'keep-last':
          mergeQueuedFileChangeBatchesOnKeepLast(this.pending[i], entry);
          this.logger.debug(`Queue[${this.serverId}]: keep-last — removing old ${this.pending[i].kind}`);
          this.pending.splice(i, 1);
          break;
        case 'queue':
          break;
      }
    }

    // Priority insertion: find the right position
    const incomingPriority = PRIORITY[entry.kind];
    let insertAt = this.pending.length;
    for (let i = 0; i < this.pending.length; i++) {
      if (PRIORITY[this.pending[i].kind] > incomingPriority) {
        insertAt = i;
        break;
      }
    }
    this.pending.splice(insertAt, 0, entry);
    this.logger.debug(`Queue[${this.serverId}]: enqueued ${entry.kind} at position ${insertAt}/${this.pending.length}`);

    void this.drain();
  }

  /** Clear all pending operations. */
  clear(): void {
    this.pending.length = 0;
  }

  /**
   * Returns the first error thrown by the executor during the last completed drain pass, then clears it.
   * Call after `waitUntilIdle` resolves to surface failures to UI.
   */
  getAndClearDrainFailure(): unknown | undefined {
    const e = this.drainFailure;
    this.drainFailure = undefined;
    return e;
  }

  /** Whether an operation is currently executing. */
  get isRunning(): boolean {
    return this.running !== null;
  }

  /** Number of pending operations. */
  get size(): number {
    return this.pending.length;
  }

  /** Current active operation kind, or null. */
  get activeKind(): OperationKind | null {
    return this.running?.kind ?? null;
  }

  /** True when no operation is running and nothing is pending. */
  get isIdle(): boolean {
    return !this.draining && this.running === null && this.pending.length === 0;
  }

  /**
   * Resolves when the queue finishes draining (no running op, no pending).
   * Safe to call when already idle.
   */
  waitUntilIdle(): Promise<void> {
    if (this.isIdle) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.idleWaiters.push(resolve);
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private flushIdleWaiters(): void {
    if (!this.isIdle) return;
    const waiters = this.idleWaiters.splice(0);
    for (const w of waiters) {
      w();
    }
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.executor) return;
    this.draining = true;
    this.drainFailure = undefined;
    try {
      while (this.pending.length > 0) {
        const entry = this.pending.shift()!;
        this.running = entry;
        try {
          await this.executor(entry);
        } catch (err) {
          this.logger.error(`Queue[${this.serverId}]: executor error for ${entry.kind}`, err);
          if (this.drainFailure === undefined) {
            this.drainFailure = err;
          }
        } finally {
          this.running = null;
        }
      }
    } finally {
      this.draining = false;
      this.flushIdleWaiters();
    }
  }
}

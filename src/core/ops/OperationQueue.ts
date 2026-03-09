import type { ServerId, DeploymentId, OperationKind } from '../types';
import type { Logger } from '../types/logger';

// ── Priority Map (§9.4) ────────────────────────────────────────────────────

const PRIORITY: Record<OperationKind, number> = {
  LifecycleStop:      1,
  LifecycleRestart:   2,
  LifecycleStart:     2,
  DeployFull:         3,
  DeployIncremental:  3,
  SyncAll:            3,
  RedeployAll:        3,
  Undeploy:           3,
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

  // SyncAll + DeployIncremental(any) → drop
  if (ek === 'SyncAll' && ik === 'DeployIncremental') return 'drop';

  // SyncAll + DeployFull(any) → queue (explicit full takes precedence)
  if (ek === 'SyncAll' && ik === 'DeployFull') return 'queue';

  // DeployIncremental(any) + SyncAll → replace pending incrementals
  if (ek === 'DeployIncremental' && ik === 'SyncAll') return 'replace';

  // RedeployAll + DeployFull/SyncAll → drop
  if (ek === 'RedeployAll' && (ik === 'DeployFull' || ik === 'SyncAll')) return 'drop';

  // DeployFull/SyncAll + RedeployAll → replace
  if ((ek === 'DeployFull' || ek === 'SyncAll') && ik === 'RedeployAll') return 'replace';

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

  // ── Internal ────────────────────────────────────────────────────────────

  private async drain(): Promise<void> {
    if (this.draining || !this.executor) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const entry = this.pending.shift()!;
        this.running = entry;
        try {
          await this.executor(entry);
        } catch (err) {
          this.logger.error(`Queue[${this.serverId}]: executor error for ${entry.kind}`, err);
        } finally {
          this.running = null;
        }
      }
    } finally {
      this.draining = false;
    }
  }
}

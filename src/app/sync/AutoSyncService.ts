import type {
  ServerConfig,
  DeploymentConfig,
  ServerId,
  DeploymentId,
  Logger,
  FileChangeBatch,
  FileChange,
  TrustGate,
} from '@core/types';
import type { EventBus } from '@core/events/EventBus';
import type { Disposable } from '@core/types/disposable';
import {
  AUTOSYNC_DEBOUNCE_MS,
  AUTOSYNC_COOLDOWN_MS,
  AUTOSYNC_FAILURE_WINDOW_MS,
  AUTOSYNC_FAILURE_THRESHOLD,
  WATCHER_GLOBAL_CAP,
  AUTOSYNC_MAX_BATCH_FILES,
  AUTOSYNC_MAX_BATCH_BYTES,
} from '../../constants';

// ── File Watcher Adapter (injected) ────────────────────────────────────────

/**
 * Abstraction over the file system watcher.
 * Implemented by ui/adapters/FileWatcherAdapter wrapping vscode.workspace.createFileSystemWatcher.
 */
export interface FileWatcherFactory {
  /**
   * Watch a directory, calling `onChange` with individual file changes.
   * Returns a disposable that stops watching.
   */
  watch(
    sourcePath: string,
    ignoreGlobs: string[],
    onChange: (change: FileChange) => void,
  ): Disposable;
}

// ── Failure Tracker ────────────────────────────────────────────────────────

interface FailureRecord {
  timestamps: number[];
  cooldownUntil: number;
}

/**
 * AutoSync service (§10.4-§10.6).
 * Coordinates file watchers, debouncing, storm protection, and failure cooldown.
 */
export class AutoSyncService {
  private readonly bus: EventBus;
  private readonly watcherFactory: FileWatcherFactory;
  private readonly logger: Logger;
  private readonly trustGate?: TrustGate;
  private readonly onSyncRequest: (
    serverId: ServerId,
    deploymentId: DeploymentId,
    batch: FileChangeBatch,
  ) => Promise<void>;

  // Active watchers: key = serverId::deploymentId
  private readonly watchers = new Map<string, Disposable>();
  // Pending changes for debounce: key = serverId::deploymentId
  private readonly pendingChanges = new Map<string, FileChange[]>();
  // Debounce timers
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Failure tracking per deployment
  private readonly failures = new Map<string, FailureRecord>();
  // Global watcher count
  private watcherCount = 0;
  // Suspended servers (stopped/error state)
  private readonly suspended = new Set<ServerId>();

  constructor(deps: {
    bus: EventBus;
    watcherFactory: FileWatcherFactory;
    logger: Logger;
    trustGate?: TrustGate;
    onSyncRequest: (
      serverId: ServerId,
      deploymentId: DeploymentId,
      batch: FileChangeBatch,
    ) => Promise<void>;
  }) {
    this.bus = deps.bus;
    this.watcherFactory = deps.watcherFactory;
    this.logger = deps.logger;
    this.trustGate = deps.trustGate;
    this.onSyncRequest = deps.onSyncRequest;
  }

  // ── Enable / Disable ──────────────────────────────────────────────

  /**
   * Enable autosync for exploded deployments with syncMode === 'auto'.
   * Respects watcher global cap (§10.4).
   */
  enable(config: ServerConfig, serverId: ServerId = config.id): void {
    if (!config.autosync.enabled) return;
    if (this.trustGate && !this.trustGate.isTrusted()) {
      this.logger.warn('AutoSyncService: watchers blocked — workspace is untrusted');
      return;
    }

    for (const dep of config.deployments) {
      if (dep.type !== 'exploded' || dep.syncMode !== 'auto') continue;
      this.startWatching(config, dep, serverId);
    }
  }

  /** Disable autosync for all deployments of a server. */
  disable(serverId: ServerId): void {
    const prefix = `${serverId}::`;
    for (const [key, disposable] of this.watchers) {
      if (key.startsWith(prefix)) {
        disposable.dispose();
        this.watchers.delete(key);
        this.watcherCount--;
      }
    }
    // Clear pending debounce timers
    for (const [key, timer] of this.debounceTimers) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        this.debounceTimers.delete(key);
        this.pendingChanges.delete(key);
      }
    }
  }

  /** Suspend when server goes to stopped/error state. */
  suspend(serverId: ServerId): void {
    this.suspended.add(serverId);
    this.logger.debug(`AutoSyncService: suspended '${serverId}'`);
  }

  /** Resume when server transitions to running. */
  resume(serverId: ServerId): void {
    this.suspended.delete(serverId);
    this.logger.debug(`AutoSyncService: resumed '${serverId}'`);
  }

  /** Record a sync failure for cooldown tracking (§10.5). */
  recordFailure(serverId: ServerId, deploymentId: DeploymentId): void {
    const key = this.watchKey(serverId, deploymentId);
    const now = Date.now();
    const record = this.failures.get(key) ?? { timestamps: [], cooldownUntil: 0 };

    // Prune failures outside the window
    record.timestamps = record.timestamps.filter(
      t => now - t < AUTOSYNC_FAILURE_WINDOW_MS,
    );
    record.timestamps.push(now);

    // Check threshold: 2 failures in 10min → 2min cooldown
    if (record.timestamps.length >= AUTOSYNC_FAILURE_THRESHOLD) {
      record.cooldownUntil = now + AUTOSYNC_COOLDOWN_MS;
      this.logger.warn(
        `AutoSyncService: cooldown activated for ${key} until ${new Date(record.cooldownUntil).toISOString()}`,
      );
    }

    this.failures.set(key, record);
  }

  /** Check if a deployment is currently in cooldown. */
  isInCooldown(serverId: ServerId, deploymentId: DeploymentId): boolean {
    const record = this.failures.get(this.watchKey(serverId, deploymentId));
    return record !== undefined && Date.now() < record.cooldownUntil;
  }

  /** Dispose all watchers and timers. */
  dispose(): void {
    for (const disposable of this.watchers.values()) {
      disposable.dispose();
    }
    this.watchers.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingChanges.clear();
    this.failures.clear();
    this.watcherCount = 0;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private watchKey(serverId: ServerId, deploymentId: DeploymentId): string {
    return `${serverId}::${deploymentId}`;
  }

  private startWatching(config: ServerConfig, dep: DeploymentConfig, serverId: ServerId): void {
    const key = this.watchKey(serverId, dep.id);

    // Already watching
    if (this.watchers.has(key)) return;

    // Global watcher cap (§10.4)
    if (this.watcherCount >= WATCHER_GLOBAL_CAP) {
      this.logger.warn(
        `AutoSyncService: watcher cap reached (${WATCHER_GLOBAL_CAP}), skipping '${dep.deployName}'`,
      );
      return;
    }

    // Merge server-level and deployment-level ignore globs
    const ignoreGlobs = [...config.autosync.ignoreGlobs, ...dep.ignoreGlobs];

    const disposable = this.watcherFactory.watch(
      dep.sourcePath,
      ignoreGlobs,
      (change: FileChange) => this.onFileChange(serverId, dep.id, change),
    );

    this.watchers.set(key, disposable);
    this.watcherCount++;
    this.logger.debug(`AutoSyncService: watching '${dep.sourcePath}' for ${key}`);
  }

  private onFileChange(serverId: ServerId, deploymentId: DeploymentId, change: FileChange): void {
    // Skip if server is suspended
    if (this.suspended.has(serverId)) return;

    // Skip if in cooldown
    if (this.isInCooldown(serverId, deploymentId)) return;

    const key = this.watchKey(serverId, deploymentId);

    // Accumulate changes
    const pending = this.pendingChanges.get(key) ?? [];
    pending.push(change);
    this.pendingChanges.set(key, pending);

    // Storm protection: check batch limits
    const totalBytes = pending.reduce((sum, c) => sum + (c.sizeBytes ?? 0), 0);
    if (pending.length > AUTOSYNC_MAX_BATCH_FILES || totalBytes > AUTOSYNC_MAX_BATCH_BYTES) {
      this.logger.warn(`AutoSyncService: storm detected for ${key}, flushing immediately`);
      this.flushPending(serverId, deploymentId);
      return;
    }

    // Reset debounce timer
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    this.debounceTimers.set(key, setTimeout(() => {
      this.flushPending(serverId, deploymentId);
    }, AUTOSYNC_DEBOUNCE_MS));
  }

  private flushPending(serverId: ServerId, deploymentId: DeploymentId): void {
    const key = this.watchKey(serverId, deploymentId);
    const changes = this.pendingChanges.get(key);
    this.pendingChanges.delete(key);
    this.debounceTimers.delete(key);

    if (!changes || changes.length === 0) return;

    const batch: FileChangeBatch = {
      changes,
      totalFiles: changes.length,
      totalBytes: changes.reduce((sum, c) => sum + (c.sizeBytes ?? 0), 0),
    };

    this.bus.emit('FileChanged', { serverId, deploymentId, batch });

    // Fire-and-forget sync request; failures are recorded by the caller
    this.onSyncRequest(serverId, deploymentId, batch).catch(cause => {
      this.logger.error(`AutoSyncService: sync request failed for ${key}`, cause);
    });
  }
}

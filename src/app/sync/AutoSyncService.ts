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
  AUTOSYNC_COOLDOWN_MS,
  AUTOSYNC_FAILURE_WINDOW_MS,
  AUTOSYNC_FAILURE_THRESHOLD,
  WATCHER_GLOBAL_CAP,
} from '../../constants';
import { resolveAutosyncWatchSpec, type WatchSpec } from './watchSpec';

// ── File Watcher Adapter (injected) ────────────────────────────────────────

/**
 * Abstraction over the file system watcher.
 * Implemented by ui/adapters/FileWatcherAdapter wrapping vscode.workspace.createFileSystemWatcher.
 */
export interface FileWatcherFactory {
  /**
   * Watch files per {@link WatchSpec} (tree or single artifact).
   */
  watch(spec: WatchSpec, onChange: (change: FileChange) => void): Disposable;
}

export type { WatchSpec } from './watchSpec';
export { resolveAutosyncWatchSpec } from './watchSpec';

// ── Failure Tracker ────────────────────────────────────────────────────────

interface FailureRecord {
  timestamps: number[];
  cooldownUntil: number;
}

interface AutosyncPolicy {
  debounceMs: number;
  maxBatchFiles: number;
  maxBatchBytes: number;
  stormBackoffMs: number;
}

interface WatchRegistration {
  disposable: Disposable;
  spec: WatchSpec;
  deploymentType: DeploymentConfig['type'];
  policy: AutosyncPolicy;
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
  private readonly watchers = new Map<string, WatchRegistration>();
  // Pending changes for debounce: key = serverId::deploymentId
  private readonly pendingChanges = new Map<string, FileChange[]>();
  // Debounce timers
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Failure tracking per deployment
  private readonly failures = new Map<string, FailureRecord>();
  // Last dispatch timestamp per deployment for local repeated-work suppression
  private readonly lastDispatchAt = new Map<string, number>();
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
   * Enable autosync for deployments with `syncMode === 'auto'` (exploded tree or WAR file).
   * Respects watcher global cap (§10.4).
   */
  enable(config: ServerConfig, serverId: ServerId = config.id): void {
    if (!config.autosync.enabled) return;
    if (this.trustGate && !this.trustGate.isTrusted()) {
      this.logger.warn('AutoSyncService: watchers blocked — workspace is untrusted');
      return;
    }

    const policy = this.autosyncPolicy(config);
    for (const dep of config.deployments) {
      const spec = resolveAutosyncWatchSpec(config, dep);
      if (!spec) continue;
      this.startWatching(dep, serverId, spec, policy);
    }
  }

  /**
   * Reconcile autosync watchers for this server against the latest persisted config.
   * Keeps existing watchers and pending debounce state when the effective watch spec is unchanged.
   */
  rebindWatchers(serverKey: ServerId, config: ServerConfig): void {
    this.resume(serverKey);

    if (!config.autosync.enabled) {
      this.disable(serverKey);
      return;
    }
    if (this.trustGate && !this.trustGate.isTrusted()) {
      this.disable(serverKey);
      this.logger.warn('AutoSyncService: watchers blocked — workspace is untrusted');
      return;
    }

    const desired = new Map<string, { dep: DeploymentConfig; spec: WatchSpec; policy: AutosyncPolicy }>();
    const policy = this.autosyncPolicy(config);
    for (const dep of config.deployments) {
      const spec = resolveAutosyncWatchSpec(config, dep);
      if (!spec) continue;
      desired.set(this.watchKey(serverKey, dep.id), { dep, spec, policy });
    }

    for (const [key, registration] of this.watchers) {
      if (!key.startsWith(`${serverKey}::`)) continue;
      const next = desired.get(key);
      if (!next || !this.sameWatchRegistration(registration, next.spec, next.dep.type, next.policy)) {
        this.removeWatcher(key);
      }
    }

    for (const [key, next] of desired) {
      if (this.watchers.has(key)) continue;
      this.startWatching(next.dep, serverKey, next.spec, next.policy);
    }
  }

  /** Disable autosync for all deployments of a server. */
  disable(serverId: ServerId): void {
    const prefix = `${serverId}::`;
    for (const [key] of this.watchers) {
      if (key.startsWith(prefix)) {
        this.removeWatcher(key);
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

  /**
   * Tear down watchers and clear suspend state when a server is removed from config.
   * Prefer this over {@link suspend} alone so the suspended set does not retain stale keys.
   */
  purgeServerWatchState(serverId: ServerId): void {
    this.disable(serverId);
    this.suspended.delete(serverId);
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
    for (const registration of this.watchers.values()) {
      registration.disposable.dispose();
    }
    this.watchers.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingChanges.clear();
    this.failures.clear();
    this.lastDispatchAt.clear();
    this.watcherCount = 0;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private autosyncPolicy(config: ServerConfig): AutosyncPolicy {
    return {
      debounceMs: config.autosync.debounceMs,
      maxBatchFiles: config.autosync.maxBatchFiles,
      maxBatchBytes: config.autosync.maxBatchBytes,
      stormBackoffMs: config.autosync.stormBackoffMs,
    };
  }

  private watchKey(serverId: ServerId, deploymentId: DeploymentId): string {
    return `${serverId}::${deploymentId}`;
  }

  private sameWatchSpec(left: WatchSpec, right: WatchSpec): boolean {
    if (left.kind !== right.kind) return false;
    if (left.kind === 'file' && right.kind === 'file') {
      return left.path === right.path;
    }
    if (left.kind === 'tree' && right.kind === 'tree') {
      return left.root === right.root
        && left.ignoreGlobs.length === right.ignoreGlobs.length
        && left.ignoreGlobs.every((pattern, index) => pattern === right.ignoreGlobs[index]);
    }
    return false;
  }

  private samePolicy(left: AutosyncPolicy, right: AutosyncPolicy): boolean {
    return left.debounceMs === right.debounceMs
      && left.maxBatchFiles === right.maxBatchFiles
      && left.maxBatchBytes === right.maxBatchBytes
      && left.stormBackoffMs === right.stormBackoffMs;
  }

  private sameWatchRegistration(
    registration: WatchRegistration,
    spec: WatchSpec,
    deploymentType: DeploymentConfig['type'],
    policy: AutosyncPolicy,
  ): boolean {
    return registration.deploymentType === deploymentType
      && this.sameWatchSpec(registration.spec, spec)
      && this.samePolicy(registration.policy, policy);
  }

  private clearPendingState(key: string): void {
    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }
    this.pendingChanges.delete(key);
    this.lastDispatchAt.delete(key);
  }

  private removeWatcher(key: string): void {
    const registration = this.watchers.get(key);
    if (!registration) return;
    registration.disposable.dispose();
    this.watchers.delete(key);
    this.watcherCount--;
    this.clearPendingState(key);
  }

  private startWatching(
    dep: DeploymentConfig,
    serverId: ServerId,
    spec: WatchSpec,
    policy: AutosyncPolicy,
  ): void {
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

    const watchPath = spec.kind === 'tree' ? spec.root : spec.path;
    const disposable = this.watcherFactory.watch(spec, (change: FileChange) =>
      this.onFileChange(serverId, dep.id, change),
    );

    this.watchers.set(key, {
      disposable,
      spec,
      deploymentType: dep.type,
      policy,
    });
    this.watcherCount++;
    this.logger.debug(`AutoSyncService: watching '${watchPath}' (${spec.kind}) for ${key}`);
  }

  private remainingBackoffMs(key: string): number {
    const registration = this.watchers.get(key);
    if (!registration || registration.deploymentType !== 'war') {
      return 0;
    }

    const lastDispatchAt = this.lastDispatchAt.get(key);
    if (lastDispatchAt === undefined) {
      return 0;
    }

    return Math.max(0, registration.policy.stormBackoffMs - (Date.now() - lastDispatchAt));
  }

  private remainingCooldownMs(serverId: ServerId, deploymentId: DeploymentId): number {
    const record = this.failures.get(this.watchKey(serverId, deploymentId));
    if (!record) {
      return 0;
    }

    return Math.max(0, record.cooldownUntil - Date.now());
  }

  private scheduleFlush(serverId: ServerId, deploymentId: DeploymentId, preferredDelayMs: number): void {
    const key = this.watchKey(serverId, deploymentId);
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const delayMs = Math.max(preferredDelayMs, this.remainingBackoffMs(key));
    this.debounceTimers.set(key, setTimeout(() => {
      this.flushPending(serverId, deploymentId);
    }, delayMs));
  }

  private onFileChange(serverId: ServerId, deploymentId: DeploymentId, change: FileChange): void {
    // Skip if server is suspended
    if (this.suspended.has(serverId)) return;

    const key = this.watchKey(serverId, deploymentId);
    const registration = this.watchers.get(key);
    if (!registration) return;

    // Accumulate changes
    const pending = this.pendingChanges.get(key) ?? [];
    pending.push(change);
    this.pendingChanges.set(key, pending);

    const remainingCooldownMs = this.remainingCooldownMs(serverId, deploymentId);
    if (remainingCooldownMs > 0) {
      this.scheduleFlush(serverId, deploymentId, remainingCooldownMs);
      return;
    }

    // Storm protection: check batch limits
    const totalBytes = pending.reduce((sum, c) => sum + (c.sizeBytes ?? 0), 0);
    if (pending.length > registration.policy.maxBatchFiles || totalBytes > registration.policy.maxBatchBytes) {
      this.logger.warn(`AutoSyncService: storm detected for ${key}, flushing immediately`);
      this.scheduleFlush(serverId, deploymentId, 0);
      return;
    }

    this.scheduleFlush(serverId, deploymentId, registration.policy.debounceMs);
  }

  private flushPending(serverId: ServerId, deploymentId: DeploymentId): void {
    const key = this.watchKey(serverId, deploymentId);
    const registration = this.watchers.get(key);
    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }

    const changes = this.pendingChanges.get(key);
    if (!changes || changes.length === 0) return;
    if (!registration) {
      this.pendingChanges.delete(key);
      return;
    }

    const remainingCooldownMs = this.remainingCooldownMs(serverId, deploymentId);
    if (remainingCooldownMs > 0) {
      this.scheduleFlush(serverId, deploymentId, remainingCooldownMs);
      return;
    }

    const remainingBackoffMs = this.remainingBackoffMs(key);
    if (remainingBackoffMs > 0) {
      this.scheduleFlush(serverId, deploymentId, remainingBackoffMs);
      return;
    }

    this.pendingChanges.delete(key);

    const batch: FileChangeBatch = {
      changes,
      totalFiles: changes.length,
      totalBytes: changes.reduce((sum, c) => sum + (c.sizeBytes ?? 0), 0),
    };

    this.lastDispatchAt.set(key, Date.now());
    this.bus.emit('FileChanged', { serverId, deploymentId, batch });

    // Fire-and-forget sync request; failures are recorded by the caller
    this.onSyncRequest(serverId, deploymentId, batch).catch(cause => {
      this.logger.error(`AutoSyncService: sync request failed for ${key}`, cause);
    });
  }
}

import type {
  ServerConfig,
  ServerId,
  DeploymentId,
  ServerState,
  StartMode,
  OperationContext,
  Logger,
  DebugAttacher,
  TrustGate,
  OutputSink,
  HookEvent,
} from '@core/types';
import { spawnSync } from 'child_process';
import * as os from 'os';
import type { FileChangeBatch } from '@core/types/events';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { EventBus } from '@core/events/EventBus';
import { decideStopEscalation, canStart, canStop } from '@core/policy/DecisionEngine';
import {
  createCancellationTokenSource,
  cancellationPromise,
  throwIfCancelled,
} from '@core/ops';
import type { OperationQueue, QueueEntry } from '@core/ops/OperationQueue';
import { QUEUE_META_FILE_CHANGE_BATCH } from '@core/ops/OperationQueue';
import type { CancellationTokenSource } from '@core/ops';
import type { IServerPlugin, StartupMonitor } from '@plugins/interfaces/IServerPlugin';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import { PidManager } from '@infra/pid';
import { PortScanner } from '@infra/ports';
import type { HookRunner } from '@app/hooks';
import type { DeploymentService } from '@app/deployment/DeploymentService';
import { ServerRuntime } from './ServerRuntime';
import { STARTUP_CALLBACK_DEBOUNCE_MS } from '../../constants';
import { makeCtx, probeAfterStartupEvent, sleep, waitForHttpReadiness } from './serverLifecycleHelpers';
import {
  runDeploymentHealthChecksOperation,
  runDeployFullOperation,
  runDeploySyncOperation,
  runDeployUndeployedOperation,
  runRedeployAllOperation,
  runUndeployOperation,
} from './serverLifecycleDeployOps';
import { reconcileRunningServers as runReconcileRunningServers } from './serverLifecycleReconcile';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ServerLifecycleDeps {
  pluginRegistry: PluginRegistry;
  bus: EventBus;
  pidManager: PidManager;
  portScanner: PortScanner;
  debugAttacher: DebugAttacher;
  logger: Logger;
  trustGate?: TrustGate;
  hookRunner?: Pick<HookRunner, 'runHooks'>;
  getOutputSink?: (serverKey: ServerId, serverName: string) => OutputSink;
  deployService: DeploymentService;
  resolveServerConfig?: (serverKey: ServerId) => ServerConfig | undefined;
  onDeploySyncFailure?: (serverKey: ServerId, deploymentId: DeploymentId) => void;
}

interface ServerEntry {
  serverKey: ServerId;
  config: ServerConfig;
  runtime: ServerRuntime;
  queue: OperationQueue;
  activeCancellation?: CancellationTokenSource;
  unregistering?: boolean;
}

type ServerEntryGuard = (entry: ServerEntry) => Result<void, JsmError>;

/**
 * Server lifecycle orchestration (§9.1–§9.9).
 * Manages start/stop/restart with OperationQueue, hooks, debug attach,
 * and reconciliation.
 */
export class ServerLifecycle {
  private readonly deps: ServerLifecycleDeps;
  private readonly servers = new Map<ServerId, ServerEntry>();

  constructor(deps: ServerLifecycleDeps) {
    this.deps = deps;
  }

  /** Register a server for lifecycle management. */
  register(serverKey: ServerId, config: ServerConfig, queue: OperationQueue): ServerRuntime {
    const runtime = new ServerRuntime(serverKey, this.deps.bus, this.deps.logger);
    const entry: ServerEntry = { serverKey, config, runtime, queue };
    this.servers.set(serverKey, entry);

    queue.setExecutor((queueEntry: QueueEntry) => this.executeOperation(serverKey, queueEntry));
    return runtime;
  }

  /** Update the config reference for a registered server. */
  updateConfig(serverId: ServerId, config: ServerConfig): void {
    const entry = this.servers.get(serverId);
    if (entry) entry.config = config;
  }

  /** Unregister a server from lifecycle management. */
  unregister(serverId: ServerId): void {
    const entry = this.servers.get(serverId);
    if (!entry) {
      return;
    }

    entry.unregistering = true;
    entry.activeCancellation?.cancel();
    entry.queue.clear();
    this.servers.delete(serverId);
  }

  /** Get the runtime state for a server. */
  getRuntime(serverId: ServerId): ServerRuntime | undefined {
    return this.servers.get(serverId)?.runtime;
  }

  // ── Public Operations ─────────────────────────────────────────────

  /** Enqueue a start operation. */
  start(serverId: ServerId, mode: StartMode): Result<void, JsmError> {
    return this.enqueueLifecycleOperation(serverId, {
      kind: 'LifecycleStart',
      meta: { mode },
    }, entry => this.requireStartableState(entry));
  }

  /** Enqueue a stop operation. */
  stop(serverId: ServerId): Result<void, JsmError> {
    return this.enqueueLifecycleOperation(serverId, { kind: 'LifecycleStop' }, entry => this.requireStoppableState(entry));
  }

  /** Enqueue a restart (stop + start). */
  restart(serverId: ServerId, mode: StartMode): Result<void, JsmError> {
    return this.enqueueLifecycleOperation(serverId, {
      kind: 'LifecycleRestart',
      meta: { mode },
    });
  }

  /** Cancel all pending operations for a server. */
  cancel(serverId: ServerId): void {
    const entry = this.servers.get(serverId);
    if (!entry) {
      return;
    }

    entry.activeCancellation?.cancel();
    entry.queue.clear();
  }

  /** Enqueue a status refresh operation (§9). */
  refreshStatus(serverId: ServerId): Result<void, JsmError> {
    return this.enqueueForServer(serverId, { kind: 'StatusRefresh' });
  }

  /**
   * Enqueue filesystem-triggered deploy sync (autosync).
   * Executes `DeploymentService.sync` on the queue with fresh config when `resolveServerConfig` is set.
   */
  enqueueDeploySync(
    serverId: ServerId,
    deploymentId: DeploymentId,
    batch: FileChangeBatch,
  ): Result<void, JsmError> {
    return this.enqueueTrustedOperation(serverId, {
      kind: 'DeploySync',
      targetDeploymentId: deploymentId,
      meta: { [QUEUE_META_FILE_CHANGE_BATCH]: batch },
    });
  }

  /** Enqueue first-time deploy for all currently undeployed applications (pre-start). */
  enqueueDeployUndeployed(serverId: ServerId): Result<void, JsmError> {
    return this.enqueueTrustedOperation(serverId, { kind: 'DeployUndeployed' });
  }

  /** Enqueue full redeploy for one deployment. */
  enqueueDeployFull(serverId: ServerId, deploymentId: DeploymentId): Result<void, JsmError> {
    return this.enqueueTrustedOperation(serverId, {
      kind: 'DeployFull',
      targetDeploymentId: deploymentId,
    });
  }

  /** Enqueue undeploy for one deployment. */
  enqueueUndeploy(serverId: ServerId, deploymentId: DeploymentId): Result<void, JsmError> {
    return this.enqueueTrustedOperation(serverId, {
      kind: 'Undeploy',
      targetDeploymentId: deploymentId,
    });
  }

  /** Enqueue full redeploy for every deployment on the server. */
  enqueueRedeployAll(serverId: ServerId): Result<void, JsmError> {
    return this.enqueueTrustedOperation(serverId, { kind: 'RedeployAll' });
  }

  /** Enqueue HTTP health checks for deployments with `healthCheckPath` (tooltip cache). */
  enqueueRunDeploymentHealthChecks(serverId: ServerId): Result<void, JsmError> {
    return this.enqueueTrustedOperation(serverId, { kind: 'RunDeploymentHealthChecks' });
  }

  /** True if the server queue is executing or has pending entries. */
  isQueueBusy(serverId: ServerId): boolean {
    const entry = this.servers.get(serverId);
    if (!entry) return false;
    return entry.queue.isRunning || entry.queue.size > 0;
  }

  /** Resolves when the server queue is idle (no running op, no pending). */
  waitUntilQueueIdle(serverId: ServerId): Promise<void> {
    const entry = this.servers.get(serverId);
    if (!entry) return Promise.resolve();
    return entry.queue.waitUntilIdle();
  }

  /** First executor error from the last drain pass for this server (then cleared). See `OperationQueue.getAndClearDrainFailure`. */
  getAndClearQueueDrainFailure(serverId: ServerId): unknown | undefined {
    return this.servers.get(serverId)?.queue.getAndClearDrainFailure();
  }

  /** Attach debugger to an already-running server. */
  async attachDebug(serverId: ServerId): Promise<Result<void, JsmError>> {
    if (!this.checkTrust()) return this.untrustedErr();

    const entry = this.servers.get(serverId);
    if (!entry) return this.notFound(serverId);

    if (entry.runtime.state !== 'running') {
      return err(new JsmError({
        code: ErrorCode.NotRunning,
        message: `Cannot attach debugger: server is in '${entry.runtime.state}' state, must be 'running'`,
      }));
    }

    if (entry.runtime.debugAttached) {
      return err(new JsmError({
        code: ErrorCode.AlreadyRunning,
        message: 'Debugger is already attached to this server',
      }));
    }

    const { config } = entry;
    const result = await this.deps.debugAttacher.attach({
      serverId,
      port: config.ports.debug ?? 5005,
      name: `Debug: ${config.name}`,
      bind: config.debug.bind,
    });

    if (result.ok) {
      entry.runtime.setDebugAttached(true);
    }

    return result;
  }

  /** Detach debugger from a running server without stopping it. */
  async detachDebug(serverId: ServerId): Promise<Result<void, JsmError>> {
    if (!this.checkTrust()) return this.untrustedErr();

    const entry = this.servers.get(serverId);
    if (!entry) return this.notFound(serverId);

    if (!entry.runtime.debugAttached) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: 'Debugger is not attached to this server',
      }));
    }

    await this.deps.debugAttacher.detach(serverId);
    entry.runtime.setDebugAttached(false);
    return ok(undefined);
  }

  /** Return server keys whose runtime state is one of the given states (e.g. for status refresh). */
  getServerKeysInState(...states: ServerState[]): ServerId[] {
    const set = new Set(states);
    return [...this.servers.entries()]
      .filter(([, e]) => set.has(e.runtime.state))
      .map(([k]) => k);
  }

  // ── Reconciliation (§9.9) ─────────────────────────────────────────

  /**
   * Reconcile running servers after activation.
   * Runs in parallel with a 2000ms budget.
   */
  async reconcileRunningServers(
    configs: Array<{ serverKey: ServerId; config: ServerConfig }>,
  ): Promise<void> {
    await runReconcileRunningServers(this.servers, {
      bus: this.deps.bus,
      pidManager: this.deps.pidManager,
      logger: this.deps.logger,
    }, configs);
  }

  // ── Internal Operation Dispatch ───────────────────────────────────

  private async executeOperation(serverId: ServerId, entry: QueueEntry): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) return;

    const { kind } = entry;
    const operationId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as OperationContext['operationId'];
    const cancellation = createCancellationTokenSource();
    server.activeCancellation = cancellation;

    this.deps.bus.emit('OperationStarted', {
      serverId,
      operationId,
      kind,
    });

    try {
      switch (kind) {
        case 'LifecycleStart':
          await this.doStart(server, (entry.meta?.['mode'] as StartMode) ?? 'run', cancellation.token);
          break;
        case 'LifecycleStop':
          await this.doStop(server, cancellation.token);
          break;
        case 'LifecycleRestart': {
          const mode = (entry.meta?.['mode'] as StartMode) ?? 'run';
          await this.doRestart(server, mode, cancellation.token);
          break;
        }
        case 'StatusRefresh':
          await this.doStatusRefresh(server, cancellation.token);
          break;
        case 'DeploySync':
          await this.doDeploySync(server, entry, operationId, cancellation.token);
          break;
        case 'DeployFull':
          await this.doDeployFull(server, entry, operationId, cancellation.token);
          break;
        case 'Undeploy':
          await this.doUndeploy(server, entry, operationId, cancellation.token);
          break;
        case 'RedeployAll':
          await this.doRedeployAll(server, operationId, cancellation.token);
          break;
        case 'DeployUndeployed':
          await this.doDeployUndeployed(server, operationId, cancellation.token);
          break;
        case 'RunDeploymentHealthChecks':
          await this.doRunDeploymentHealthChecks(server, operationId, cancellation.token);
          break;
        case 'DeployIncremental':
        case 'DeployHotReload':
        case 'SyncAll':
          throw new JsmError({
            code: ErrorCode.Unsupported,
            message: `Operation '${kind}' must be enqueued only via a supported composite path`,
          });
      }

      this.deps.bus.emit('OperationCompleted', {
        serverId,
        operationId,
        kind,
      });
    } catch (cause) {
      const error = cause instanceof JsmError
        ? cause
        : JsmError.fromUnknown(cause);

      this.deps.bus.emit('OperationFailed', {
        serverId,
        operationId,
        kind,
        error,
      });
      throw error;
    } finally {
      if (server.activeCancellation === cancellation) {
        server.activeCancellation = undefined;
      }
    }
  }

  // ── Start Flow ────────────────────────────────────────────────────

  private async doStart(
    server: ServerEntry,
    mode: StartMode,
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    await this.doStartInternal(server, mode, cancel, 'lifecycle.start');
  }

  private async doStartInternal(
    server: ServerEntry,
    mode: StartMode,
    cancel: OperationContext['cancel'],
    hookEvent?: HookEvent,
  ): Promise<void> {
    const { config, runtime } = server;
    const plugin = this.getPlugin(config);
    const timeoutMs = this.getStartTimeoutMs(config, mode);
    let requiresFailedStartCleanup = false;

    const ctx = makeCtx(
      server.serverKey,
      'LifecycleStart',
      timeoutMs,
      cancel,
      this.deps.getOutputSink?.(server.serverKey, config.name),
    );

    try {
      if (hookEvent) {
        await this.runServerHooks(server, ctx, 'pre', hookEvent);
      }
      throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled before launch.`);

      runtime.transition('starting', { startMode: mode });

      const startResult = await plugin.start(ctx, config, mode);
      if (!startResult.ok) {
        runtime.transition('error', { error: startResult.error });
        throw startResult.error;
      }

      const { pid, startupMonitor } = startResult.value;
      await this.deps.pidManager.writePid(server.serverKey, pid, {
        instancePath: config.instancePath,
        runtimeHomePath: config.runtime.homePath,
      });
      requiresFailedStartCleanup = true;
      throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled while waiting for readiness.`);

      const ready = await this.waitForStartReadiness(config, timeoutMs, ctx, startupMonitor);

      if (!ready) {
        runtime.transition('error', {
          error: new JsmError({
            code: ErrorCode.Timeout,
            message: `Server '${config.name}' failed readiness check within ${timeoutMs}ms`,
          }),
        });
        throw new JsmError({
          code: ErrorCode.Timeout,
          message: `Readiness timeout for '${config.name}'`,
        });
      }

      throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled after readiness.`);
      runtime.transition('running', { pid });

      await this.runPostStartVerification(server, plugin, ctx);
      await this.attachDebuggerAfterStart(server, mode, ctx);
      requiresFailedStartCleanup = false;

      if (hookEvent) {
        await this.runServerHooks(server, ctx, 'post', hookEvent);
      }
    } catch (cause) {
      const error = cause instanceof JsmError ? cause : JsmError.fromUnknown(cause);
      const detachedDuringStart = server.unregistering === true;
      if (requiresFailedStartCleanup) {
        if (detachedDuringStart) {
          await this.cleanupAfterDetachedStart(server);
        } else {
          await this.cleanupAfterFailedStart(server, plugin);
        }
      }
      if (!detachedDuringStart && runtime.state === 'starting') {
        runtime.transition('error', { error });
      } else if (!detachedDuringStart && runtime.state === 'running') {
        runtime.transition('error', { error });
      }
      if (!detachedDuringStart && !(error.code === ErrorCode.Cancelled && runtime.state === 'stopped')) {
        await this.runServerOnErrorHooks(server, ctx, hookEvent, error);
      }
      throw error;
    }
  }

  private async cleanupAfterFailedStart(
    server: ServerEntry,
    plugin: IServerPlugin,
  ): Promise<void> {
    const { config, runtime } = server;
    const cleanupCtx = makeCtx(
      server.serverKey,
      'LifecycleStop',
      config.timeouts?.stopMs ?? 20_000,
      createCancellationTokenSource().token,
      this.deps.getOutputSink?.(server.serverKey, config.name),
    );

    try {
      const stopResult = await plugin.stop(cleanupCtx, config);
      if (!stopResult.ok) {
        this.deps.logger.warn(`ServerLifecycle: failed-start cleanup stop error for '${config.name}'`, stopResult.error);
      }
    } catch (cause) {
      this.deps.logger.warn(`ServerLifecycle: failed-start cleanup threw for '${config.name}'`, cause);
    }

    try {
      await this.deps.pidManager.clearPid(server.serverKey);
    } catch (cause) {
      this.deps.logger.warn(`ServerLifecycle: failed to clear PID after start failure for '${config.name}'`, cause);
    }

    try {
      await this.deps.debugAttacher.detach(server.serverKey);
    } catch (cause) {
      this.deps.logger.warn(`ServerLifecycle: failed to detach debugger after start failure for '${config.name}'`, cause);
    }

    runtime.setDebugAttached(false);
  }

  private async cleanupAfterDetachedStart(server: ServerEntry): Promise<void> {
    const { config, runtime } = server;

    try {
      await this.deps.pidManager.clearPid(server.serverKey);
    } catch (cause) {
      this.deps.logger.warn(`ServerLifecycle: failed to clear PID after detached start cancellation for '${config.name}'`, cause);
    }

    try {
      await this.deps.debugAttacher.detach(server.serverKey);
    } catch (cause) {
      this.deps.logger.warn(`ServerLifecycle: failed to detach debugger after detached start cancellation for '${config.name}'`, cause);
    }

    runtime.setDebugAttached(false);
  }

  private async waitForStartReadiness(
    config: ServerConfig,
    timeoutMs: number,
    ctx: OperationContext,
    startupMonitor?: StartupMonitor,
  ): Promise<boolean> {
    try {
      if (startupMonitor) {
        const outcome = await Promise.race([
          startupMonitor.waitForOutcome(this.remainingContextBudgetMs(ctx)),
          cancellationPromise(ctx.cancel, `Start operation for '${config.name}' was cancelled while waiting for readiness.`),
        ]);
        if (outcome.state === 'failed') {
          throw outcome.error ?? new JsmError({
            code: ErrorCode.ProcessSpawnFailed,
            message: outcome.message ?? `Server '${config.name}' reported a startup failure`,
          });
        }
        return probeAfterStartupEvent(
          this.deps.portScanner,
          config,
          STARTUP_CALLBACK_DEBOUNCE_MS,
          ctx,
        );
      }

      return waitForHttpReadiness(this.deps.portScanner, config, timeoutMs, ctx.startedAt, ctx);
    } finally {
      await startupMonitor?.dispose();
    }
  }

  private async runPostStartVerification(
    server: ServerEntry,
    plugin: IServerPlugin,
    ctx: OperationContext,
  ): Promise<void> {
    const { config, runtime } = server;

    if (plugin.healthCheck) {
      throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled before health checks.`);
      const healthResult = await plugin.healthCheck(ctx, config);
      if (!healthResult.ok) {
        runtime.transition('error', { error: healthResult.error });
        throw healthResult.error;
      }
      if (!healthResult.value.ok) {
        const error = new JsmError({
          code: ErrorCode.ValidationFailed,
          message: 'Health check failed: server not responding',
          details: `HTTP probe to ${config.host}:${config.ports.http} failed`,
        });
        runtime.transition('error', { error });
        throw error;
      }
    }

    throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled before deployment health checks.`);
    await this.deps.deployService.runHealthChecksForServer(server.serverKey, config);
  }

  private async attachDebuggerAfterStart(
    server: ServerEntry,
    mode: StartMode,
    ctx: OperationContext,
  ): Promise<void> {
    const { config, runtime } = server;
    if (mode !== 'debug' || !config.debug.enabled) {
      return;
    }

    await Promise.race([
      sleep(config.debug.attachDelayMs),
      cancellationPromise(ctx.cancel, `Start operation for '${config.name}' was cancelled before debugger attach.`),
    ]);
    throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled before debugger attach.`);
    const attachResult = await this.deps.debugAttacher.attach({
      serverId: server.serverKey,
      port: config.ports.debug ?? 5005,
      name: `Debug: ${config.name}`,
      bind: config.debug.bind,
    });
    if (attachResult.ok) {
      runtime.setDebugAttached(true);
    }
  }

  // ── Stop Flow ─────────────────────────────────────────────────────

  private async doStop(
    server: ServerEntry,
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    await this.doStopInternal(server, cancel, 'lifecycle.stop');
  }

  private async doStopInternal(
    server: ServerEntry,
    cancel: OperationContext['cancel'],
    hookEvent?: HookEvent,
  ): Promise<void> {
    const { config, runtime } = server;
    const plugin = this.getPlugin(config);

    if (runtime.state === 'stopped') return;

    const timeoutMs = config.timeouts?.stopMs ?? 20_000;
    const ctx = makeCtx(
      server.serverKey,
      'LifecycleStop',
      timeoutMs,
      cancel,
      this.deps.getOutputSink?.(server.serverKey, config.name),
    );

    try {
      if (hookEvent) {
        await this.runServerHooks(server, ctx, 'pre', hookEvent);
      }
      throwIfCancelled(ctx.cancel, `Stop operation for '${config.name}' was cancelled before shutdown.`);

      runtime.transition('stopping');

      const stopResult = await plugin.stop(ctx, config);
      if (!stopResult.ok) {
        this.deps.logger.warn(`ServerLifecycle: stop error for '${config.name}'`, stopResult.error);
      }

      await this.waitForShutdownOrEscalate(config, runtime.pid, timeoutMs, ctx);
      await this.finalizeStoppedServer(server);

      if (hookEvent) {
        await this.runServerHooks(server, ctx, 'post', hookEvent);
      }
    } catch (cause) {
      const error = cause instanceof JsmError ? cause : JsmError.fromUnknown(cause);
      if (!(error.code === ErrorCode.Cancelled && runtime.state === 'running')) {
        await this.runServerOnErrorHooks(server, ctx, hookEvent, error);
      }
      throw error;
    }
  }

  private async waitForShutdownOrEscalate(
    config: ServerConfig,
    pid: number | undefined,
    timeoutMs: number,
    ctx: OperationContext,
  ): Promise<void> {
    if (!pid) {
      return;
    }

    let forceKillAttempted = false;

    while (Date.now() - ctx.startedAt < timeoutMs) {
      throwIfCancelled(ctx.cancel, `Stop operation for '${config.name}' was cancelled while waiting for shutdown.`);
      if (!this.deps.pidManager.isProcessAlive(pid)) {
        return;
      }

      const decision = decideStopEscalation(Date.now() - ctx.startedAt, timeoutMs);
      if (decision === 'force-kill') {
        this.forceKillProcess(config, pid);
        forceKillAttempted = true;
        break;
      }

      await Promise.race([
        sleep(500),
        cancellationPromise(ctx.cancel, `Stop operation for '${config.name}' was cancelled while waiting for shutdown.`),
      ]);
    }

    if (this.deps.pidManager.isProcessAlive(pid)) {
      if (!forceKillAttempted) {
        this.forceKillProcess(config, pid);
      }

      if (this.deps.pidManager.isProcessAlive(pid)) {
        throw new JsmError({
          code: ErrorCode.Timeout,
          message: `Server '${config.name}' did not stop within ${timeoutMs}ms and could not be force-killed.`,
          details: `PID ${pid} is still alive.`,
        });
      }
    }
  }

  private forceKillProcess(config: ServerConfig, pid: number): void {
    this.deps.logger.warn(`ServerLifecycle: force-killing ${config.name} (PID ${pid})`);
    try {
      if (os.platform() === 'win32') {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
          shell: false,
          stdio: 'ignore',
          windowsHide: true,
        });
        return;
      }

      process.kill(pid, 'SIGKILL');
    } catch {
      // Liveness is checked by the caller after the kill attempt.
    }
  }

  private async finalizeStoppedServer(server: ServerEntry): Promise<void> {
    const { runtime } = server;
    await this.deps.pidManager.clearPid(server.serverKey);
    await this.deps.debugAttacher.detach(server.serverKey);
    runtime.setDebugAttached(false);
    runtime.transition('stopped');
  }

  private async doRestart(
    server: ServerEntry,
    mode: StartMode,
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    const { config, runtime } = server;
    const hookEvent: HookEvent = 'lifecycle.restart';
    const timeoutMs = (config.timeouts?.stopMs ?? 20_000) + this.getStartTimeoutMs(config, mode);
    const ctx = makeCtx(
      server.serverKey,
      'LifecycleRestart',
      timeoutMs,
      cancel,
      this.deps.getOutputSink?.(server.serverKey, config.name),
    );

    try {
      await this.runServerHooks(server, ctx, 'pre', hookEvent);
      throwIfCancelled(ctx.cancel, `Restart operation for '${config.name}' was cancelled before restart.`);
      await this.doStopInternal(server, cancel);
      await this.doStartInternal(server, mode, cancel);
      await this.runServerHooks(server, ctx, 'post', hookEvent);
    } catch (cause) {
      const error = cause instanceof JsmError ? cause : JsmError.fromUnknown(cause);
      if (!(error.code === ErrorCode.Cancelled && runtime.state === 'running')) {
        await this.runServerOnErrorHooks(server, ctx, hookEvent, error);
      }
      throw error;
    }
  }

  private async doDeployFull(
    server: ServerEntry,
    entry: QueueEntry,
    busOperationId: OperationContext['operationId'],
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    await runDeployFullOperation(this.deps, server, entry, busOperationId, cancel);
  }

  private async doUndeploy(
    server: ServerEntry,
    entry: QueueEntry,
    busOperationId: OperationContext['operationId'],
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    await runUndeployOperation(this.deps, server, entry, busOperationId, cancel);
  }

  private async doRedeployAll(
    server: ServerEntry,
    busOperationId: OperationContext['operationId'],
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    await runRedeployAllOperation(this.deps, server, busOperationId, cancel);
  }

  private async doDeployUndeployed(
    server: ServerEntry,
    busOperationId: OperationContext['operationId'],
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    await runDeployUndeployedOperation(this.deps, server, busOperationId, cancel);
  }

  private async doRunDeploymentHealthChecks(
    server: ServerEntry,
    _busOperationId: OperationContext['operationId'],
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    await runDeploymentHealthChecksOperation(this.deps, server, cancel);
  }

  // ── Deploy sync (autosync) ──────────────────────────────────────

  private async doDeploySync(
    server: ServerEntry,
    entry: QueueEntry,
    busOperationId: OperationContext['operationId'],
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    await runDeploySyncOperation(this.deps, server, entry, busOperationId, cancel);
  }

  // ── Status Refresh ────────────────────────────────────────────────

  private async doStatusRefresh(
    server: ServerEntry,
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    const { config, runtime } = server;
    const plugin = this.getPlugin(config);

    const ctx = makeCtx(
      server.serverKey,
      'StatusRefresh',
      5000,
      cancel,
      this.deps.getOutputSink?.(server.serverKey, config.name),
    );
    const result = await plugin.getStatus(ctx, config);
    if (!result.ok) return;

    const status = result.value;
    if (status.state !== runtime.state) {
      runtime.forceState(status.state, { pid: status.pid });
    }

    if (status.state === 'running' && plugin.healthCheck) {
      const healthResult = await plugin.healthCheck(ctx, config);
      if (!healthResult.ok) {
        runtime.transition('error', { error: healthResult.error });
        return;
      }
      if (!healthResult.value.ok) {
        runtime.transition('error', {
          error: new JsmError({
            code: ErrorCode.ValidationFailed,
            message: 'Health check failed: server not responding',
            details: `HTTP probe to ${config.host}:${config.ports.http} failed`,
          }),
        });
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private getPlugin(config: ServerConfig): IServerPlugin {
    const plugin = this.deps.pluginRegistry.get(config.type);
    if (!plugin) {
      throw new JsmError({
        code: ErrorCode.Unsupported,
        message: `No plugin found for server type '${config.type}'`,
      });
    }
    return plugin;
  }

  private notFound(serverId: ServerId): Result<never, JsmError> {
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: `Server '${serverId}' not registered`,
    }));
  }

  private checkTrust(): boolean {
    return !this.deps.trustGate || this.deps.trustGate.isTrusted();
  }

  private requireServerEntry(
    serverId: ServerId,
    options: { requireTrust?: boolean } = {},
  ): Result<ServerEntry, JsmError> {
    if (options.requireTrust && !this.checkTrust()) {
      return this.untrustedErr();
    }

    const entry = this.servers.get(serverId);
    if (!entry) {
      return this.notFound(serverId);
    }

    return ok(entry);
  }

  private enqueueForServer(
    serverId: ServerId,
    queueEntry: QueueEntry,
    options: { requireTrust?: boolean; guard?: ServerEntryGuard } = {},
  ): Result<void, JsmError> {
    const entryResult = this.requireServerEntry(serverId, options);
    if (!entryResult.ok) {
      return entryResult;
    }

    if (options.guard) {
      const guardResult = options.guard(entryResult.value);
      if (!guardResult.ok) {
        return guardResult;
      }
    }

    return this.enqueueServerEntry(entryResult.value, queueEntry);
  }

  private enqueueServerEntry(entry: ServerEntry, queueEntry: QueueEntry): Result<void, JsmError> {
    entry.queue.enqueue(queueEntry);
    return ok(undefined);
  }

  private enqueueLifecycleOperation(
    serverId: ServerId,
    queueEntry: QueueEntry,
    guard?: ServerEntryGuard,
  ): Result<void, JsmError> {
    return this.enqueueForServer(serverId, queueEntry, { requireTrust: true, guard });
  }

  private enqueueTrustedOperation(serverId: ServerId, queueEntry: QueueEntry): Result<void, JsmError> {
    return this.enqueueForServer(serverId, queueEntry, { requireTrust: true });
  }

  private requireStartableState(entry: ServerEntry): Result<void, JsmError> {
    if (canStart(entry.runtime.state)) {
      return ok(undefined);
    }

    return err(new JsmError({
      code: ErrorCode.AlreadyRunning,
      message: `Cannot start: server is in '${entry.runtime.state}' state`,
    }));
  }

  private requireStoppableState(entry: ServerEntry): Result<void, JsmError> {
    if (canStop(entry.runtime.state)) {
      return ok(undefined);
    }

    return err(new JsmError({
      code: ErrorCode.NotRunning,
      message: `Cannot stop: server is in '${entry.runtime.state}' state`,
    }));
  }

  private getStartTimeoutMs(config: ServerConfig, mode: StartMode): number {
    return mode === 'debug'
      ? (config.timeouts?.startDebugMs ?? 45_000)
      : (config.timeouts?.startRunMs ?? 30_000);
  }

  private remainingContextBudgetMs(ctx: OperationContext): number {
    return Math.max(1, ctx.timeoutMs - (Date.now() - ctx.startedAt));
  }

  private async runServerHooks(
    server: ServerEntry,
    ctx: OperationContext,
    phase: 'pre' | 'post' | 'onError',
    event: HookEvent,
  ): Promise<void> {
    if (!this.deps.hookRunner) return;
    const result = await this.deps.hookRunner.runHooks({
      parent: ctx,
      phase,
      event,
      hooks: server.config.hooks,
    });
    if (!result.ok) {
      throw result.error;
    }
  }

  private async runServerOnErrorHooks(
    server: ServerEntry,
    ctx: OperationContext,
    event: HookEvent | undefined,
    cause: unknown,
  ): Promise<void> {
    if (!event || !this.deps.hookRunner) return;
    const result = await this.deps.hookRunner.runHooks({
      parent: ctx,
      phase: 'onError',
      event,
      hooks: server.config.hooks,
    });
    if (!result.ok) {
      this.deps.logger.warn(`ServerLifecycle: onError hook failed for '${server.config.name}'`, result.error);
    }
    if (
      cause instanceof JsmError
      && server.runtime.state !== 'error'
      && server.runtime.state !== 'stopped'
    ) {
      server.runtime.transition('error', { error: cause });
    }
  }

  private untrustedErr(): Result<never, JsmError> {
    return err(new JsmError({
      code: ErrorCode.WorkspaceUntrusted,
      message: 'Grant workspace trust to manage servers.',
    }));
  }
}

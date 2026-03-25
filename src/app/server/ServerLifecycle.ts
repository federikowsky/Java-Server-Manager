import type {
  ServerConfig,
  ServerId,
  DeploymentId,
  ServerState,
  StartMode,
  OperationContext,
  OperationKind,
  Logger,
  DebugAttacher,
  TrustGate,
  OutputSink,
  HookEvent,
} from '@core/types';
import type { FileChangeBatch } from '@core/types/events';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { EventBus } from '@core/events/EventBus';
import { decideReadiness, decideStopEscalation, canStart, canStop } from '@core/policy/DecisionEngine';
import {
  createCancellationTokenSource,
  cancellationPromise,
  throwIfCancelled,
} from '@core/ops';
import type { OperationQueue, QueueEntry } from '@core/ops/OperationQueue';
import { QUEUE_META_FILE_CHANGE_BATCH } from '@core/ops/OperationQueue';
import type { CancellationTokenSource } from '@core/ops';
import type { IServerPlugin } from '@plugins/interfaces/IServerPlugin';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import { PidManager } from '@infra/pid';
import { PortScanner } from '@infra/ports';
import type { HookRunner } from '@app/hooks';
import type { DeploymentService } from '@app/deployment/DeploymentService';
import { ServerRuntime } from './ServerRuntime';
import {
  READINESS_PROBE_INTERVAL_MS,
  RECONCILIATION_BUDGET_MS,
  STARTUP_CALLBACK_DEBOUNCE_MS,
} from '../../constants';

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
  deployService?: DeploymentService;
  resolveServerConfig?: (serverKey: ServerId) => ServerConfig | undefined;
  onDeploySyncFailure?: (serverKey: ServerId, deploymentId: DeploymentId) => void;
}

interface ServerEntry {
  serverKey: ServerId;
  config: ServerConfig;
  runtime: ServerRuntime;
  queue: OperationQueue;
  activeCancellation?: CancellationTokenSource;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * When startup monitor reported 'started' (AFTER_START_EVENT), do one port probe after a short
 * debounce instead of polling. No loop.
 */
async function probeAfterStartupEvent(
  portScanner: PortScanner,
  config: ServerConfig,
  debounceMs: number,
  ctx: OperationContext,
): Promise<boolean> {
  await Promise.race([
    sleep(debounceMs),
    cancellationPromise(ctx.cancel, `Start operation for '${config.name}' was cancelled.`),
  ]);
  throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled.`);
  const portOpen = await portScanner.probe(config.ports.http, config.host);
  return portOpen;
}

async function waitForHttpReadiness(
  portScanner: PortScanner,
  config: ServerConfig,
  timeoutMs: number,
  startedAt: number,
  ctx: OperationContext,
): Promise<boolean> {
  let ready = false;

  while (!ready && (Date.now() - startedAt) < timeoutMs) {
    throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled.`);
    const portOpen = await portScanner.probe(config.ports.http, config.host);
    const decision = decideReadiness({
      portOpen,
      elapsed: Date.now() - startedAt,
      timeoutMs,
    });

    if (decision === 'ready') {
      ready = true;
      break;
    }

    if (decision === 'timeout') {
      break;
    }

    await Promise.race([
      sleep(READINESS_PROBE_INTERVAL_MS),
      cancellationPromise(ctx.cancel, `Start operation for '${config.name}' was cancelled.`),
    ]);
  }

  return ready;
}

function makeCtx(
  serverId: ServerId,
  kind: OperationKind,
  timeoutMs: number,
  cancel: OperationContext['cancel'],
  outputSink?: OutputSink,
): OperationContext {
  return {
    operationId: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as OperationContext['operationId'],
    serverId,
    kind,
    startedAt: Date.now(),
    timeoutMs,
    cancel,
    progress: {
      report: (msg: string) => outputSink?.appendLine(msg),
    },
    output: {
      append: (text: string) => outputSink?.append(text),
      appendLine: (text: string) => outputSink?.appendLine(text),
      clear: () => outputSink?.clear(),
    },
  };
}

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
    this.servers.delete(serverId);
  }

  /** Get the runtime state for a server. */
  getRuntime(serverId: ServerId): ServerRuntime | undefined {
    return this.servers.get(serverId)?.runtime;
  }

  // ── Public Operations ─────────────────────────────────────────────

  /** Enqueue a start operation. */
  start(serverId: ServerId, mode: StartMode): Result<void, JsmError> {
    if (!this.checkTrust()) return this.untrustedErr();

    const entry = this.servers.get(serverId);
    if (!entry) return this.notFound(serverId);

    if (!canStart(entry.runtime.state)) {
      return err(new JsmError({
        code: ErrorCode.AlreadyRunning,
        message: `Cannot start: server is in '${entry.runtime.state}' state`,
      }));
    }

    entry.queue.enqueue({
      kind: 'LifecycleStart',
      meta: { mode },
    });
    return ok(undefined);
  }

  /** Enqueue a stop operation. */
  stop(serverId: ServerId): Result<void, JsmError> {
    if (!this.checkTrust()) return this.untrustedErr();

    const entry = this.servers.get(serverId);
    if (!entry) return this.notFound(serverId);

    if (!canStop(entry.runtime.state)) {
      return err(new JsmError({
        code: ErrorCode.NotRunning,
        message: `Cannot stop: server is in '${entry.runtime.state}' state`,
      }));
    }

    entry.queue.enqueue({ kind: 'LifecycleStop' });
    return ok(undefined);
  }

  /** Enqueue a restart (stop + start). */
  restart(serverId: ServerId, mode: StartMode): Result<void, JsmError> {
    if (!this.checkTrust()) return this.untrustedErr();

    const entry = this.servers.get(serverId);
    if (!entry) return this.notFound(serverId);

    entry.queue.enqueue({
      kind: 'LifecycleRestart',
      meta: { mode },
    });
    return ok(undefined);
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
    const entry = this.servers.get(serverId);
    if (!entry) return this.notFound(serverId);

    entry.queue.enqueue({ kind: 'StatusRefresh' });
    return ok(undefined);
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
    if (!this.checkTrust()) return this.untrustedErr();

    const entry = this.servers.get(serverId);
    if (!entry) return this.notFound(serverId);

    entry.queue.enqueue({
      kind: 'DeploySync',
      targetDeploymentId: deploymentId,
      meta: { [QUEUE_META_FILE_CHANGE_BATCH]: batch },
    });
    return ok(undefined);
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
    this.deps.logger.info(`ServerLifecycle: reconciling ${configs.length} servers`);

    const tasks = configs.map(({ serverKey, config }) => this.reconcileOne(serverKey, config));

    await Promise.race([
      Promise.all(tasks),
      sleep(RECONCILIATION_BUDGET_MS).then(() => {
        this.deps.logger.warn('ServerLifecycle: reconciliation budget exceeded');
      }),
    ]);

    this.deps.bus.emit('WorkspaceLoaded', { serverCount: configs.length });
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
          await this.doDeploySync(server, entry, cancellation.token);
          break;
        default:
          this.deps.logger.warn(`ServerLifecycle: unhandled operation kind '${kind}'`);
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
      await this.deps.pidManager.writePid(server.serverKey, pid);
      throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled while waiting for readiness.`);

      let ready = false;

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
          ready = await probeAfterStartupEvent(
            this.deps.portScanner,
            config,
            STARTUP_CALLBACK_DEBOUNCE_MS,
            ctx,
          );
        } else {
          ready = await waitForHttpReadiness(this.deps.portScanner, config, timeoutMs, ctx.startedAt, ctx);
        }
      } finally {
        await startupMonitor?.dispose();
      }

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

      if (plugin.healthCheck) {
        throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled before health checks.`);
        const healthResult = await plugin.healthCheck(ctx, config);
        if (!healthResult.ok) {
          runtime.transition('error', { error: healthResult.error });
          throw healthResult.error;
        }
        if (!healthResult.value.ok) {
          const err = new JsmError({
            code: ErrorCode.ValidationFailed,
            message: 'Health check failed: server not responding',
            details: `HTTP probe to ${config.host}:${config.ports.http} failed`,
          });
          runtime.transition('error', { error: err });
          throw err;
        }
      }

      if (this.deps.deployService) {
        throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled before deployment health checks.`);
        await this.deps.deployService.runHealthChecksForServer(server.serverKey, config);
      }

      if (mode === 'debug' && config.debug.enabled) {
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

      if (hookEvent) {
        await this.runServerHooks(server, ctx, 'post', hookEvent);
      }
    } catch (cause) {
      const error = cause instanceof JsmError ? cause : JsmError.fromUnknown(cause);
      if (runtime.state === 'starting') {
        runtime.transition('error', { error });
      }
      if (!(error.code === ErrorCode.Cancelled && runtime.state === 'stopped')) {
        await this.runServerOnErrorHooks(server, ctx, hookEvent, error);
      }
      throw error;
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

      const pid = runtime.pid;

      if (pid) {
        while (Date.now() - ctx.startedAt < timeoutMs) {
          throwIfCancelled(ctx.cancel, `Stop operation for '${config.name}' was cancelled while waiting for shutdown.`);
          if (!this.deps.pidManager.isProcessAlive(pid)) break;

          const decision = decideStopEscalation(Date.now() - ctx.startedAt, timeoutMs);
          if (decision === 'force-kill') {
            this.deps.logger.warn(`ServerLifecycle: force-killing ${config.name} (PID ${pid})`);
            try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
            break;
          }
          await Promise.race([
            sleep(500),
            cancellationPromise(ctx.cancel, `Stop operation for '${config.name}' was cancelled while waiting for shutdown.`),
          ]);
        }
      }

      await this.deps.pidManager.clearPid(server.serverKey);
      await this.deps.debugAttacher.detach(server.serverKey);
      runtime.setDebugAttached(false);
      runtime.transition('stopped');

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

  private async doRestart(
    server: ServerEntry,
    mode: StartMode,
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    const hookEvent: HookEvent = 'lifecycle.restart';
    const timeoutMs = (server.config.timeouts?.stopMs ?? 20_000) + this.getStartTimeoutMs(server.config, mode);
    const ctx = makeCtx(
      server.serverKey,
      'LifecycleRestart',
      timeoutMs,
      cancel,
      this.deps.getOutputSink?.(server.serverKey, server.config.name),
    );

    try {
      await this.runServerHooks(server, ctx, 'pre', hookEvent);
      throwIfCancelled(ctx.cancel, `Restart operation for '${server.config.name}' was cancelled before restart.`);
      await this.doStopInternal(server, cancel);
      await this.doStartInternal(server, mode, cancel);
      await this.runServerHooks(server, ctx, 'post', hookEvent);
    } catch (cause) {
      const error = cause instanceof JsmError ? cause : JsmError.fromUnknown(cause);
      if (!(error.code === ErrorCode.Cancelled && server.runtime.state === 'running')) {
        await this.runServerOnErrorHooks(server, ctx, hookEvent, error);
      }
      throw error;
    }
  }

  // ── Deploy sync (autosync) ──────────────────────────────────────

  private async doDeploySync(
    server: ServerEntry,
    entry: QueueEntry,
    cancel: OperationContext['cancel'],
  ): Promise<void> {
    const deployService = this.deps.deployService;
    if (!deployService) {
      this.deps.logger.warn('ServerLifecycle: DeploySync skipped — deployService not configured');
      return;
    }

    const deploymentId = entry.targetDeploymentId;
    if (!deploymentId) {
      this.deps.logger.warn('ServerLifecycle: DeploySync missing targetDeploymentId');
      return;
    }

    const batch = entry.meta?.[QUEUE_META_FILE_CHANGE_BATCH] as FileChangeBatch | undefined;
    if (!batch || !Array.isArray(batch.changes)) {
      this.deps.logger.warn('ServerLifecycle: DeploySync missing fileChangeBatch meta');
      return;
    }

    const serverKey = server.serverKey;
    const config = this.deps.resolveServerConfig?.(serverKey) ?? server.config;
    const dep = config.deployments.find(d => d.id === deploymentId);
    if (!dep) {
      this.deps.logger.warn(`ServerLifecycle: DeploySync deployment '${deploymentId}' not found`);
      return;
    }

    const ctx = makeCtx(
      serverKey,
      'DeploySync',
      30_000,
      cancel,
      this.deps.getOutputSink?.(serverKey, config.name),
    );
    ctx.targetDeploymentId = deploymentId;

    try {
      const result = await deployService.sync(ctx, config, dep, batch);
      if (!result.ok) {
        this.deps.onDeploySyncFailure?.(serverKey, deploymentId);
      }
    } catch (cause) {
      this.deps.onDeploySyncFailure?.(serverKey, deploymentId);
      throw cause;
    }
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

  // ── Reconcile One Server (§9.9) ───────────────────────────────────

  private async reconcileOne(serverKey: ServerId, config: ServerConfig): Promise<void> {
    const entry = this.servers.get(serverKey);
    if (!entry) return;

    const { runtime } = entry;

    try {
      const pid = await this.deps.pidManager.readPid(serverKey);

      if (!pid) {
        // No PID file → stopped
        if (runtime.state !== 'stopped') {
          runtime.forceState('stopped');
        }
        return;
      }

      const alive = this.deps.pidManager.isProcessAlive(pid);

      if (alive) {
        runtime.forceState('running', { pid, startMode: runtime.lastStartMode });
      } else {
        // Stale PID
        await this.deps.pidManager.clearPid(serverKey);
        runtime.forceState('stopped');
        this.deps.logger.warn(`ServerLifecycle: stale PID file removed for '${config.name}'`);
      }
    } catch (e) {
      this.deps.logger.error(`ServerLifecycle: reconciliation error for '${config.name}'`, e);
      runtime.forceState('stopped');
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

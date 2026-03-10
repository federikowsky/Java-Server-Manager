import type {
  ServerConfig,
  ServerId,
  StartMode,
  OperationContext,
  OperationKind,
  Logger,
  DebugAttacher,
  TrustGate,
  OutputSink,
  HookEvent,
} from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { EventBus } from '@core/events/EventBus';
import { decideReadiness, decideStopEscalation, canStart, canStop } from '@core/policy/DecisionEngine';
import type { OperationQueue, QueueEntry } from '@core/ops/OperationQueue';
import type { IServerPlugin } from '@plugins/interfaces/IServerPlugin';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import { PidManager } from '@infra/pid';
import { PortScanner } from '@infra/ports';
import type { HookRunner } from '@app/hooks';
import { ServerRuntime } from './ServerRuntime';
import { READINESS_PROBE_INTERVAL_MS, RECONCILIATION_BUDGET_MS } from '../../constants';

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
}

interface ServerEntry {
  serverKey: ServerId;
  config: ServerConfig;
  runtime: ServerRuntime;
  queue: OperationQueue;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function makeCtx(
  serverId: ServerId,
  _serverName: string,
  kind: OperationKind,
  timeoutMs: number,
  _logger: Logger,
  outputSink?: OutputSink,
): OperationContext {
  return {
    operationId: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as OperationContext['operationId'],
    serverId,
    kind,
    startedAt: Date.now(),
    timeoutMs,
    cancel: {
      isCancelled: false,
      onCancelled: () => ({ dispose: () => {} }),
    },
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
    if (entry) entry.queue.clear();
  }

  /** Enqueue a status refresh operation (§9). */
  refreshStatus(serverId: ServerId): Result<void, JsmError> {
    const entry = this.servers.get(serverId);
    if (!entry) return this.notFound(serverId);

    entry.queue.enqueue({ kind: 'StatusRefresh' });
    return ok(undefined);
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

    this.deps.bus.emit('OperationStarted', {
      serverId,
      operationId: `op-${Date.now()}` as OperationContext['operationId'],
      kind,
    });

    try {
      switch (kind) {
        case 'LifecycleStart':
          await this.doStart(server, (entry.meta?.['mode'] as StartMode) ?? 'run');
          break;
        case 'LifecycleStop':
          await this.doStop(server);
          break;
        case 'LifecycleRestart': {
          const mode = (entry.meta?.['mode'] as StartMode) ?? 'run';
          await this.doRestart(server, mode);
          break;
        }
        case 'StatusRefresh':
          await this.doStatusRefresh(server);
          break;
        default:
          this.deps.logger.warn(`ServerLifecycle: unhandled operation kind '${kind}'`);
      }

      this.deps.bus.emit('OperationCompleted', {
        serverId,
        operationId: `op-${Date.now()}` as OperationContext['operationId'],
        kind,
      });
    } catch (cause) {
      const error = cause instanceof JsmError
        ? cause
        : JsmError.fromUnknown(cause);

      this.deps.bus.emit('OperationFailed', {
        serverId,
        operationId: `op-${Date.now()}` as OperationContext['operationId'],
        kind,
        error,
      });
    }
  }

  // ── Start Flow ────────────────────────────────────────────────────

  private async doStart(server: ServerEntry, mode: StartMode): Promise<void> {
    await this.doStartInternal(server, mode, 'lifecycle.start');
  }

  private async doStartInternal(server: ServerEntry, mode: StartMode, hookEvent?: HookEvent): Promise<void> {
    const { config, runtime } = server;
    const plugin = this.getPlugin(config);

    if (hookEvent) {
      await this.runServerHooks(server, 'pre', hookEvent);
    }

    runtime.transition('starting', { startMode: mode });

    const timeoutMs = mode === 'debug'
      ? (config.timeouts?.startDebugMs ?? 45_000)
      : (config.timeouts?.startRunMs ?? 30_000);

    const ctx = makeCtx(
      server.serverKey,
      config.name,
      'LifecycleStart',
      timeoutMs,
      this.deps.logger,
      this.deps.getOutputSink?.(server.serverKey, config.name),
    );

    try {
      const startResult = await plugin.start(ctx, config, mode);
      if (!startResult.ok) {
        runtime.transition('error', { error: startResult.error });
        throw startResult.error;
      }

      const { pid } = startResult.value;
      await this.deps.pidManager.writePid(server.serverKey, pid);

      // Readiness probe loop
      const startedAt = Date.now();
      let ready = false;

      while (!ready && (Date.now() - startedAt) < timeoutMs) {
        await sleep(READINESS_PROBE_INTERVAL_MS);

        const portOpen = await this.deps.portScanner.probe(config.ports.http, config.host);
        const decision = decideReadiness({
          portOpen,
          elapsed: Date.now() - startedAt,
          timeoutMs,
        });

        if (decision === 'ready') {
          ready = true;
        } else if (decision === 'timeout') {
          break;
        }
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

      runtime.transition('running', { pid });

      if (mode === 'debug' && config.debug.enabled) {
        await sleep(config.debug.attachDelayMs);
        await this.deps.debugAttacher.attach({
          serverId: server.serverKey,
          port: config.ports.debug,
          name: `Debug: ${config.name}`,
          bind: config.debug.bind,
        });
      }

      if (hookEvent) {
        await this.runServerHooks(server, 'post', hookEvent);
      }
    } catch (cause) {
      await this.runServerOnErrorHooks(server, hookEvent, cause);
      throw cause;
    }
  }

  // ── Stop Flow ─────────────────────────────────────────────────────

  private async doStop(server: ServerEntry): Promise<void> {
    await this.doStopInternal(server, 'lifecycle.stop');
  }

  private async doStopInternal(server: ServerEntry, hookEvent?: HookEvent): Promise<void> {
    const { config, runtime } = server;
    const plugin = this.getPlugin(config);

    if (runtime.state === 'stopped') return;

    if (hookEvent) {
      await this.runServerHooks(server, 'pre', hookEvent);
    }

    runtime.transition('stopping');

    const timeoutMs = config.timeouts?.stopMs ?? 20_000;
    const ctx = makeCtx(
      server.serverKey,
      config.name,
      'LifecycleStop',
      timeoutMs,
      this.deps.logger,
      this.deps.getOutputSink?.(server.serverKey, config.name),
    );

    try {
      const stopResult = await plugin.stop(ctx, config);
      if (!stopResult.ok) {
        this.deps.logger.warn(`ServerLifecycle: stop error for '${config.name}'`, stopResult.error);
      }

      const startedAt = Date.now();
      const pid = runtime.pid;

      if (pid) {
        while (Date.now() - startedAt < timeoutMs) {
          if (!this.deps.pidManager.isProcessAlive(pid)) break;

          const decision = decideStopEscalation(Date.now() - startedAt, timeoutMs);
          if (decision === 'force-kill') {
            this.deps.logger.warn(`ServerLifecycle: force-killing ${config.name} (PID ${pid})`);
            try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
            break;
          }
          await sleep(500);
        }
      }

      await this.deps.pidManager.clearPid(server.serverKey);
      await this.deps.debugAttacher.detach(server.serverKey);
      runtime.transition('stopped');

      if (hookEvent) {
        await this.runServerHooks(server, 'post', hookEvent);
      }
    } catch (cause) {
      await this.runServerOnErrorHooks(server, hookEvent, cause);
      throw cause;
    }
  }

  private async doRestart(server: ServerEntry, mode: StartMode): Promise<void> {
    const hookEvent: HookEvent = 'lifecycle.restart';
    await this.runServerHooks(server, 'pre', hookEvent);
    try {
      await this.doStopInternal(server);
      await this.doStartInternal(server, mode);
      await this.runServerHooks(server, 'post', hookEvent);
    } catch (cause) {
      await this.runServerOnErrorHooks(server, hookEvent, cause);
      throw cause;
    }
  }

  // ── Status Refresh ────────────────────────────────────────────────

  private async doStatusRefresh(server: ServerEntry): Promise<void> {
    const { config, runtime } = server;
    const plugin = this.getPlugin(config);

    const ctx = makeCtx(
      server.serverKey,
      config.name,
      'StatusRefresh',
      5000,
      this.deps.logger,
      this.deps.getOutputSink?.(server.serverKey, config.name),
    );
    const result = await plugin.getStatus(ctx, config);
    if (!result.ok) return;

    const status = result.value;
    if (status.state !== runtime.state) {
      runtime.forceState(status.state, { pid: status.pid });
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

  private async runServerHooks(server: ServerEntry, phase: 'pre' | 'post' | 'onError', event: HookEvent): Promise<void> {
    if (!this.deps.hookRunner) return;
    const result = await this.deps.hookRunner.runHooks(server.serverKey, phase, event, server.config.hooks);
    if (!result.ok) {
      throw result.error;
    }
  }

  private async runServerOnErrorHooks(server: ServerEntry, event: HookEvent | undefined, cause: unknown): Promise<void> {
    if (!event || !this.deps.hookRunner) return;
    const result = await this.deps.hookRunner.runHooks(server.serverKey, 'onError', event, server.config.hooks);
    if (!result.ok) {
      this.deps.logger.warn(`ServerLifecycle: onError hook failed for '${server.config.name}'`, result.error);
    }
    if (cause instanceof JsmError) {
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

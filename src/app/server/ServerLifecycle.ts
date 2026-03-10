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
  getOutputSink?: (serverId: ServerId, serverName: string) => OutputSink;
}

interface ServerEntry {
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
  register(config: ServerConfig, queue: OperationQueue): ServerRuntime {
    const runtime = new ServerRuntime(config.id, this.deps.bus, this.deps.logger);
    const entry: ServerEntry = { config, runtime, queue };
    this.servers.set(config.id, entry);

    queue.setExecutor((queueEntry: QueueEntry) => this.executeOperation(config.id, queueEntry));
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
    configs: ServerConfig[],
  ): Promise<void> {
    this.deps.logger.info(`ServerLifecycle: reconciling ${configs.length} servers`);

    const tasks = configs.map(config => this.reconcileOne(config));

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
          await this.doStop(server);
          await this.doStart(server, mode);
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
    const { config, runtime } = server;
    const plugin = this.getPlugin(config);

    runtime.transition('starting', { startMode: mode });

    const timeoutMs = mode === 'debug'
      ? (config.timeouts?.startDebugMs ?? 45_000)
      : (config.timeouts?.startRunMs ?? 30_000);

    const ctx = makeCtx(
      config.id,
      config.name,
      'LifecycleStart',
      timeoutMs,
      this.deps.logger,
      this.deps.getOutputSink?.(config.id, config.name),
    );

    const startResult = await plugin.start(ctx, config, mode);
    if (!startResult.ok) {
      runtime.transition('error', { error: startResult.error });
      throw startResult.error;
    }

    const { pid } = startResult.value;
    await this.deps.pidManager.writePid(config.id, pid);

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
      // else 'retry' → continue loop
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

    // Debug attach
    if (mode === 'debug' && config.debug.enabled) {
      await sleep(config.debug.attachDelayMs);
      await this.deps.debugAttacher.attach({
        port: config.ports.debug,
        name: `Debug: ${config.name}`,
        bind: config.debug.bind,
      });
    }
  }

  // ── Stop Flow ─────────────────────────────────────────────────────

  private async doStop(server: ServerEntry): Promise<void> {
    const { config, runtime } = server;
    const plugin = this.getPlugin(config);

    if (runtime.state === 'stopped') return;

    runtime.transition('stopping');

    const timeoutMs = config.timeouts?.stopMs ?? 20_000;
    const ctx = makeCtx(
      config.id,
      config.name,
      'LifecycleStop',
      timeoutMs,
      this.deps.logger,
      this.deps.getOutputSink?.(config.id, config.name),
    );

    const stopResult = await plugin.stop(ctx, config);
    if (!stopResult.ok) {
      this.deps.logger.warn(`ServerLifecycle: stop error for '${config.name}'`, stopResult.error);
    }

    // Wait for graceful shutdown with escalation
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

    await this.deps.pidManager.clearPid(config.id);
    await this.deps.debugAttacher.detach(config.id);
    runtime.transition('stopped');
  }

  // ── Status Refresh ────────────────────────────────────────────────

  private async doStatusRefresh(server: ServerEntry): Promise<void> {
    const { config, runtime } = server;
    const plugin = this.getPlugin(config);

    const ctx = makeCtx(
      config.id,
      config.name,
      'StatusRefresh',
      5000,
      this.deps.logger,
      this.deps.getOutputSink?.(config.id, config.name),
    );
    const result = await plugin.getStatus(ctx, config);
    if (!result.ok) return;

    const status = result.value;
    if (status.state !== runtime.state) {
      runtime.forceState(status.state, { pid: status.pid });
    }
  }

  // ── Reconcile One Server (§9.9) ───────────────────────────────────

  private async reconcileOne(config: ServerConfig): Promise<void> {
    const entry = this.servers.get(config.id);
    if (!entry) return;

    const { runtime } = entry;

    try {
      const pid = await this.deps.pidManager.readPid(config.id);

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
        await this.deps.pidManager.clearPid(config.id);
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

  private untrustedErr(): Result<never, JsmError> {
    return err(new JsmError({
      code: ErrorCode.WorkspaceUntrusted,
      message: 'Grant workspace trust to manage servers.',
    }));
  }
}

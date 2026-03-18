import type {
  ServerId,
  ServerState,
  StartMode,
  Logger,
} from '@core/types';
import type { ServerRuntimeState } from '@core/types';
import type { EventBus } from '@core/events/EventBus';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

// ── Allowed Transitions (§9.1) ──────────────────────────────────────────────

const TRANSITIONS: Record<ServerState, ReadonlySet<ServerState>> = {
  stopped:  new Set<ServerState>(['starting']),
  starting: new Set<ServerState>(['running', 'error', 'stopped']),
  running:  new Set<ServerState>(['stopping', 'error']),
  stopping: new Set<ServerState>(['stopped']),
  error:    new Set<ServerState>(['starting', 'stopped']),
};

/**
 * Per-server FSM state machine (§9.1).
 * Tracks server state, PID, and last start mode.
 * Emits `ServerStateChanged` on every valid transition.
 */
export class ServerRuntime {
  private _state: ServerRuntimeState;
  private readonly bus: EventBus;
  private readonly logger: Logger;

  constructor(serverId: ServerId, bus: EventBus, logger: Logger) {
    this._state = {
      serverId,
      state: 'stopped',
      lastTransitionAt: Date.now(),
      debugAttached: false,
    };
    this.bus = bus;
    this.logger = logger;
  }

  get serverId(): ServerId { return this._state.serverId; }
  get state(): ServerState { return this._state.state; }
  get pid(): number | undefined { return this._state.pid; }
  get lastStartMode(): StartMode | undefined { return this._state.lastStartMode; }
  get lastTransitionAt(): number { return this._state.lastTransitionAt; }
  get lastError(): JsmError | undefined { return this._state.lastError; }
  get debugAttached(): boolean { return this._state.debugAttached; }

  /** Get the full runtime state snapshot. */
  getState(): ServerRuntimeState {
    return { ...this._state };
  }

  /**
   * Transition to a new state.
   * Throws if the transition is not allowed per the FSM table.
   */
  transition(
    to: ServerState,
    opts?: { pid?: number; startMode?: StartMode; error?: JsmError },
  ): void {
    const from = this._state.state;
    if (!TRANSITIONS[from].has(to)) {
      throw new JsmError({
        code: ErrorCode.OperationInProgress,
        message: `Invalid state transition: ${from} → ${to}`,
        details: `Server '${this._state.serverId}' is in '${from}' state`,
      });
    }

    const prev = from;
    this._state = {
      ...this._state,
      state: to,
      lastTransitionAt: Date.now(),
      pid: opts?.pid ?? (to === 'stopped' ? undefined : this._state.pid),
      lastStartMode: opts?.startMode ?? this._state.lastStartMode,
      lastError: opts?.error ?? (to === 'error' ? this._state.lastError : undefined),
    };

    this.logger.info(`ServerRuntime[${this._state.serverId}]: ${prev} → ${to}`);
    this.bus.emit('ServerStateChanged', {
      serverId: this._state.serverId,
      state: to,
      prevState: prev,
    });
  }

  /**
   * Reset from error to stopped (§9.1).
   * Only valid if state is `error` and process is dead (caller must verify).
   */
  reset(): void {
    if (this._state.state !== 'error') {
      throw new JsmError({
        code: ErrorCode.OperationInProgress,
        message: `Cannot reset: server is in '${this._state.state}' state, not 'error'`,
      });
    }
    this.transition('stopped');
  }

  /**
   * Force-set state for reconciliation (§9.9).
   * Bypasses normal transition rules — used only during startup reconciliation.
   */
  forceState(state: ServerState, opts?: { pid?: number; startMode?: StartMode }): void {
    const prev = this._state.state;
    this._state = {
      ...this._state,
      state,
      lastTransitionAt: Date.now(),
      pid: opts?.pid,
      lastStartMode: opts?.startMode ?? this._state.lastStartMode,
      lastError: undefined,
    };

    this.logger.info(`ServerRuntime[${this._state.serverId}]: force ${prev} → ${state}`);
    this.bus.emit('ServerStateChanged', {
      serverId: this._state.serverId,
      state,
      prevState: prev,
    });
  }

  /** Set debug-attached state and emit event for tree refresh. */
  setDebugAttached(attached: boolean): void {
    if (this._state.debugAttached === attached) return;
    this._state = { ...this._state, debugAttached: attached };
    this.logger.info(`ServerRuntime[${this._state.serverId}]: debugAttached → ${attached}`);
    this.bus.emit('ServerStateChanged', {
      serverId: this._state.serverId,
      state: this._state.state,
      prevState: this._state.state,
    });
  }
}

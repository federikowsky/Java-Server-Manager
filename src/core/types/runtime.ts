import type { ServerId, DeploymentId, OperationId } from './ids';
import type { ServerState, DeploymentState, StartMode } from './enums';
import type { Disposable } from './disposable';
import type { JsmError } from '../errors/JsmError';
import type { Result } from '../result';

// ── Runtime State ───────────────────────────────────────────────────────────

export interface ServerRuntimeState {
  serverId: ServerId;
  state: ServerState;
  pid?: number;
  lastTransitionAt: number;  // Epoch ms
  lastError?: JsmError;
  lastStartMode?: StartMode;
  debugAttached: boolean;    // true when debugger is attached
}

export interface DeploymentRuntimeState {
  serverId: ServerId;
  deploymentId: DeploymentId;
  state: DeploymentState;
  lastSyncAt?: number;  // Epoch ms
  lastError?: JsmError;
}

// ── Workspace Trust ─────────────────────────────────────────────────────────

/** Injected gate that checks vscode.workspace.isTrusted (§12.8). */
export interface TrustGate {
  isTrusted(): boolean;
}

// ── Operation Types ─────────────────────────────────────────────────────────

export type OperationKind =
  | 'LifecycleStart'
  | 'LifecycleStop'
  | 'LifecycleRestart'
  | 'DeployFull'
  | 'DeployIncremental'
  | 'DeploySync'
  | 'DeployHotReload'
  | 'SyncAll'
  | 'RedeployAll'
  | 'Undeploy'
  | 'StatusRefresh';

// ── Infrastructure Interfaces ───────────────────────────────────────────────
// Defined in core, implemented in infra/ or ui/adapters/.

/** Token checked by operations at cancellation checkpoints. */
export interface CancellationToken {
  readonly isCancelled: boolean;
  onCancelled(callback: () => void): Disposable;
}

/** Sink for structured log output. Implemented by OutputSinkAdapter (ui/adapters). */
export interface OutputSink {
  append(text: string): void;
  appendLine(text: string): void;
  clear(): void;
}

/** Sink for operation progress messages. */
export interface ProgressSink {
  report(message: string): void;
}

/** Debug session management. Injected into ServerLifecycle. */
export interface DebugAttacher {
  attach(config: { serverId: ServerId; port: number; name: string; bind: string }): Promise<Result<void, JsmError>>;
  detach(serverId: ServerId): Promise<void>;
}

/** Key-value store abstraction. Implemented by ui/adapters wrapping vscode.Memento. */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

// ── Operation Context ───────────────────────────────────────────────────────

export interface OperationContext {
  operationId: OperationId;
  serverId: ServerId;
  kind: OperationKind;
  targetDeploymentId?: DeploymentId;
  startedAt: number;
  timeoutMs: number;
  cancel: CancellationToken;
  progress: ProgressSink;
  output: OutputSink;
}

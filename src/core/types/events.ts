import type { ServerId, DeploymentId, OperationId } from './ids';
import type { ServerState, DeploymentState } from './enums';
import type { JsmError } from '../errors/JsmError';
import type { OperationKind } from './runtime';

// ── File Change Batch (§6.3) ────────────────────────────────────────────────

export interface FileChange {
  type: 'add' | 'change' | 'delete';
  /** Absolute path to the changed file. */
  path: string;
  /** Path relative to the deployment sourcePath. */
  relativePath: string;
  sizeBytes?: number;
}

export interface FileChangeBatch {
  changes: FileChange[];
  totalFiles: number;
  totalBytes: number;
}

// ── Event Map ───────────────────────────────────────────────────────────────

export interface EventMap {
  // Config lifecycle
  ServerAdded:            { serverId: ServerId };
  ServerUpdated:          { serverId: ServerId };
  ServerDeleted:          { serverId: ServerId };
  // Server runtime
  ServerStateChanged:     { serverId: ServerId; state: ServerState; prevState: ServerState };
  // Deployment config
  DeploymentAdded:        { serverId: ServerId; deploymentId: DeploymentId };
  DeploymentUpdated:      { serverId: ServerId; deploymentId: DeploymentId };
  DeploymentRemoved:      { serverId: ServerId; deploymentId: DeploymentId };
  // Deployment runtime
  DeploymentStateChanged: { serverId: ServerId; deploymentId: DeploymentId; state: DeploymentState };
  // Operations
  OperationStarted:       { serverId: ServerId; operationId: OperationId; kind: OperationKind };
  OperationCompleted:     { serverId: ServerId; operationId: OperationId; kind: OperationKind };
  OperationFailed:        { serverId: ServerId; operationId: OperationId; kind: OperationKind; error: JsmError };
  // Workspace
  WorkspaceLoaded:        { serverCount: number };
  ConfigChanged:          { source: 'user' | 'migration' | 'wizard' | 'external' };
  // File watching
  FileChanged:            { serverId: ServerId; deploymentId: DeploymentId; batch: FileChangeBatch };
}

export type EventKey = keyof EventMap;

import type { ServerId, DeploymentId, OperationId } from './ids';
import type { ServerState, DeploymentState } from './enums';
import type { JsmError } from '../errors/JsmError';
import type { OperationKind, OperationTimelineStepKind } from './runtime';

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
  ServerAdded:            { serverId: ServerId; workspaceFolderUri: string };
  ServerUpdated:          { serverId: ServerId; workspaceFolderUri: string };
  ServerDeleted:          { serverId: ServerId; workspaceFolderUri: string };
  // Server runtime
  ServerStateChanged:     { serverId: ServerId; state: ServerState; prevState: ServerState };
  // Deployment config
  DeploymentAdded:        { serverId: ServerId; deploymentId: DeploymentId; workspaceFolderUri: string };
  DeploymentUpdated:      { serverId: ServerId; deploymentId: DeploymentId; workspaceFolderUri: string };
  DeploymentRemoved:      { serverId: ServerId; deploymentId: DeploymentId; workspaceFolderUri: string };
  // Deployment runtime
  DeploymentStateChanged: { serverId: ServerId; deploymentId: DeploymentId; state: DeploymentState };
  // Operations
  OperationStarted:       { serverId: ServerId; operationId: OperationId; kind: OperationKind; targetDeploymentId?: DeploymentId };
  OperationCompleted:     { serverId: ServerId; operationId: OperationId; kind: OperationKind; targetDeploymentId?: DeploymentId };
  OperationFailed:        { serverId: ServerId; operationId: OperationId; kind: OperationKind; targetDeploymentId?: DeploymentId; error: JsmError };
  OperationStepStarted:   { serverId: ServerId; operationId: OperationId; stepId: string; label: string; kind: OperationTimelineStepKind; targetDeploymentId?: DeploymentId; message?: string };
  OperationStepCompleted: { serverId: ServerId; operationId: OperationId; stepId: string; message?: string };
  OperationStepFailed:    { serverId: ServerId; operationId: OperationId; stepId: string; error: JsmError };
  // Workspace
  WorkspaceLoaded:        { serverCount: number };
  ConfigChanged:          { source: 'user' | 'migration' | 'wizard' | 'external'; workspaceFolderUri: string };
  // File watching
  FileChanged:            { serverId: ServerId; deploymentId: DeploymentId; batch: FileChangeBatch };
}

export type EventKey = keyof EventMap;

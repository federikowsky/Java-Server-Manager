// src/types/runtime.ts
// -----------------------------------------------------------------------------
//  Stato effimero, non serializzato

import { ChildProcess } from 'child_process';
import { FSWatcher }    from 'chokidar';
import { ServerState, DeploymentState } from './domain';

export type ServerStartMode = 'run' | 'debug';

export interface DeploymentRuntimeInfo {
  state         : DeploymentState;
  watcher?      : FSWatcher;
  lastSync?     : string;          // ISO datetime
  error?        : string;
}

export interface ServerRuntimeInfo {
  pid           : number;
  pidFile       : string;          // uguale al domain, ma certo
  process       : ChildProcess;
  state         : ServerState;
  mode          : ServerStartMode;
  debugPort?    : number;
  debugSession? : string;
  deployments   : Record<string, DeploymentRuntimeInfo>;
  logStream?    : NodeJS.ReadableStream;
}
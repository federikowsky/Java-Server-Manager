/*
 * src/core/plugins/interfaces/IServerStatus.ts
 * Interface for real-time server status monitoring
 */

import { ServerState } from '../../types/domain';
import { Result } from '../../utils/result';
import { JsmError } from '../../errors/JsmError';
import { EventEmitter } from 'events';

/**
 * Server status information
 */
export interface ServerStatusInfo {
  serverId: string;
  state: ServerState;
  pid?: number;
  uptime?: number;
  lastCheck: Date;
  healthStatus: 'healthy' | 'unhealthy' | 'unknown';
}

/**
 * Status monitoring configuration
 */
export interface StatusMonitoringConfig {
  interval: number; // milliseconds
  timeout: number;  // milliseconds
  retries: number;
  healthCheckUrl?: string;
}

/**
 * Server status events
 */
export interface ServerStatusEvents {
  stateChanged: { serverId: string; oldState: ServerState; newState: ServerState };
  processStarted: { serverId: string; pid: number };
  processStopped: { serverId: string; pid?: number };
  healthChanged: { serverId: string; healthy: boolean };
}

export interface IServerStatus extends EventEmitter {
  readonly state: ServerState;
  readonly pid: number;
  readonly isRunning: boolean;
  readonly lastCheck: Date;

  // Monitoring lifecycle
  startMonitoring(): Promise<Result<void, JsmError>>;
  stopMonitoring(): Promise<Result<void, JsmError>>;

  // Manual status check
  checkStatus(): Promise<Result<ServerState, JsmError>>;

  // Health verification
  verifyHealth(): Promise<Result<boolean, JsmError>>;

  // State updates
  updateState(state: ServerState): void;
  updatePid(pid: number): void;

  // Events: 'stateChanged', 'processStarted', 'processStopped', 'healthChanged'
}

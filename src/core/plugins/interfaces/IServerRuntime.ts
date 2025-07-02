/*
 * Streamlined runtime interface - Pure state management
 * Single responsibility: Server instance lifecycle coordination
 */

import { ServerConfig, DeploymentConfig, ServerState } from '../../types/domain';
import { ServerStartMode } from '../../types/runtime';
import { Result } from '../../utils/result';
import { JsmError } from '../../errors/JsmError';

/**
 * Server runtime information for status monitoring
 */
export interface ServerRuntimeInfo {
  serverId: string;
  state: ServerState;
  uptime?: number;
  memoryUsage?: number;
  cpuUsage?: number;
  lastHealthCheck?: Date;
}

/**
 * Deployment runtime information
 */
export interface DeploymentRuntimeInfo {
  deploymentId: string;
  appName: string;
  status: 'deployed' | 'failed' | 'deploying' | 'undeploying';
  deployTime?: Date;
  size?: number;
}

/**
 * Server performance metrics
 */
export interface ServerMetrics {
  cpu: number;
  memory: number;
  threads?: number;
  requests?: {
    total: number;
    active: number;
    errors: number;
  };
}

/**
 * Runtime wrapper - Coordinates plugin and state
 */
export interface IServerRuntime {
  readonly serverId: string;
  readonly config: ServerConfig;

  // State management
  getCurrentState(): ServerState;
  
  // Lifecycle delegation to plugin
  start(mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>>;
  stop(): Promise<Result<void, JsmError>>;
  restart(mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>>;

  // Deployment delegation
  deploy(deployment: DeploymentConfig): Promise<Result<void, JsmError>>;
  undeploy(deploymentId: string): Promise<Result<void, JsmError>>;

  // Health monitoring
  healthCheck(): Promise<Result<boolean, JsmError>>;

  // Configuration updates
  updateConfig(config: ServerConfig): void;

  // Cleanup
  dispose(): Promise<void>;
}

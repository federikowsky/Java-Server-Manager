/*
 * Streamlined plugin interface - Pure SRP implementation
 * Zero dependencies on complex metadata structures
 */

import { ServerConfig, DeploymentConfig, ServerState } from '../../../types/domain';
import { ServerStartMode } from '../../../types/runtime';
import { Result } from '../../../utils/result';
import { JsmError } from '../../../errors/JsmError';

/**
 * Minimal plugin interface - Single responsibility only
 */
export interface IServerPlugin {
  readonly type: string;
  readonly name: string;

  // Core lifecycle (SRP)
  start(config: ServerConfig, mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>>;
  stop(config: ServerConfig): Promise<Result<void, JsmError>>;
  restart(config: ServerConfig, mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>>;

  // Status monitoring (real-time)
  getStatus(config: ServerConfig): Promise<Result<ServerState, JsmError>>;
  healthCheck(config: ServerConfig): Promise<Result<boolean, JsmError>>;

  // Deployment operations
  deploy(config: ServerConfig, deployment: DeploymentConfig): Promise<Result<void, JsmError>>;
  undeploy(config: ServerConfig, deploymentId: string): Promise<Result<void, JsmError>>;
  
  // Optional incremental deployment support for plugins that can support it
  deployIncremental?(config: ServerConfig, deployment: DeploymentConfig): Promise<Result<void, JsmError>>;

  // Configuration
  getDefaultConfig(): Partial<ServerConfig>;

  // Detection & cleanup
  detect(homePath: string): Promise<Result<boolean, JsmError>>;
  dispose(): Promise<void>;
}

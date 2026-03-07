/*
 * src/core/server/ServerRuntime.ts
 * Server state management + lifecycle - Single responsibility
 */

import { EventBus } from '../EventBus';
import { PluginAdapter } from './PluginAdapter';
import { ServerConfig, ServerState, DeploymentConfig } from '../types/domain';
import { ServerStartMode, ServerRuntimeInfo } from '../types/runtime';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Logger } from '../utils/logger';

/**
 * ServerRuntime - Single responsibility: Server state management + lifecycle
 */
export class ServerRuntime {
  private readonly log = Logger.getInstance().createChild('ServerRuntime');
  private readonly eventBus = EventBus.getInstance();
  private currentState: ServerState;
  private runtimeInfo: ServerRuntimeInfo | null = null;

  constructor(
    public readonly config: ServerConfig,
    private readonly pluginAdapter: PluginAdapter
  ) {
    // Initialize runtime state (not from config since state is no longer in ServerConfig)
    this.currentState = 'stopped';
  }

  /**
   * Get current server state
   */
  getCurrentState(): ServerState {
    return this.currentState;
  }

  /**
   * Update server state and emit event
   */
  private updateState(newState: ServerState): void {
    if (this.currentState !== newState) {
      const oldState = this.currentState;
      this.currentState = newState;
      
      // Emit state change event for coordination (no longer update config)
      this.eventBus.emit('ServerStateChanged', {
        id: this.config.id,
        state: newState
      });
      
      this.log.debug(`State transition: ${this.config.name} ${oldState} → ${newState}`);
    }
  }

  /**
   * Start server
   */
  async start(mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>> {
    if (this.currentState === 'running') {
      return err(new JsmError(ErrorCode.SERVER_ALREADY_RUNNING, `Server ${this.config.name} is already running`));
    }

    this.log.info(`Starting server ${this.config.name} in ${mode} mode`);
    this.updateState('starting');

    try {
      // Detect server type from serverHome
      const typeResult = await this.pluginAdapter.detectServerType(this.config.serverHome);
      if (!typeResult.ok) {
        this.updateState('error');
        return err(new JsmError(ErrorCode.SERVER_TYPE_DETECTION_ERROR, 'Failed to detect server type'));
      }

      const plugin = await this.pluginAdapter.getPlugin(typeResult.value);
      if (!plugin.ok) {
        this.updateState('error');
        return plugin as any;
      }

      const startResult = await plugin.value.start(this.config, mode, debugPort);
      
      if (startResult.ok) {
        this.updateState('running');
        this.log.info(`Successfully started server ${this.config.name}`);
      } else {
        this.updateState('error');
        this.log.error(`Failed to start server ${this.config.name}: ${startResult.error.message}`);
      }
      
      return startResult;
    } catch (error) {
      this.updateState('error');
      return err(new JsmError(ErrorCode.SERVER_STARTUP_ERROR, `Server start failed: ${error}`, error));
    }
  }

  /**
   * Stop server
   */
  async stop(): Promise<Result<void, JsmError>> {
    if (this.currentState === 'stopped') {
      return ok(undefined); // Already stopped
    }

    this.log.info(`Stopping server ${this.config.name}`);
    this.updateState('stopping');

    try {
      // Detect server type from serverHome
      const typeResult = await this.pluginAdapter.detectServerType(this.config.serverHome);
      if (!typeResult.ok) {
        this.updateState('error');
        return err(new JsmError(ErrorCode.SERVER_TYPE_DETECTION_ERROR, 'Failed to detect server type'));
      }

      const plugin = await this.pluginAdapter.getPlugin(typeResult.value);
      if (!plugin.ok) {
        this.updateState('error');
        return plugin as any;
      }

      const stopResult = await plugin.value.stop(this.config);
      
      if (stopResult.ok) {
        this.updateState('stopped');
        this.runtimeInfo = null;
        this.log.info(`Successfully stopped server ${this.config.name}`);
      } else {
        this.updateState('error');
        this.log.error(`Failed to stop server ${this.config.name}: ${stopResult.error.message}`);
      }
      
      return stopResult;
    } catch (error) {
      this.updateState('error');
      return err(new JsmError(ErrorCode.SERVER_STOP_ERROR, `Server stop failed: ${error}`, error));
    }
  }

  /**
   * Restart server
   */
  async restart(mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>> {
    this.log.info(`Restarting server ${this.config.name} in ${mode} mode`);

    // Stop first if running
    if (this.currentState === 'running') {
      const stopResult = await this.stop();
      if (!stopResult.ok) {
        return stopResult;
      }
    }

    // Wait a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start again
    return this.start(mode, debugPort);
  }

  /**
   * Deploy application
   */
  async deploy(deployment: DeploymentConfig): Promise<Result<void, JsmError>> {
    const deployName = deployment.deployName || this.extractNameFromPath(deployment.sourcePath);
    this.log.info(`Deploying ${deployName} to ${this.config.name}`);

    try {
      // Detect server type from serverHome
      const typeResult = await this.pluginAdapter.detectServerType(this.config.serverHome);
      if (!typeResult.ok) {
        return err(new JsmError(ErrorCode.SERVER_TYPE_DETECTION_ERROR, 'Failed to detect server type'));
      }

      const plugin = await this.pluginAdapter.getPlugin(typeResult.value);
      if (!plugin.ok) {
        return plugin as any;
      }

      const deployResult = await plugin.value.deploy(this.config, deployment);
      
      if (deployResult.ok) {
        this.log.info(`Successfully deployed ${deployName}`);
      } else {
        this.log.error(`Failed to deploy ${deployName}: ${deployResult.error.message}`);
      }
      
      return deployResult;
    } catch (error) {
      return err(new JsmError(ErrorCode.DEPLOY_ERROR, `Deployment failed: ${error}`, error));
    }
  }

  /**
   * Undeploy application
   */
  async undeploy(deploymentId: string): Promise<Result<void, JsmError>> {
    this.log.info(`Undeploying ${deploymentId} from ${this.config.name}`);

    try {
      // Detect server type from serverHome
      const typeResult = await this.pluginAdapter.detectServerType(this.config.serverHome);
      if (!typeResult.ok) {
        return err(new JsmError(ErrorCode.SERVER_TYPE_DETECTION_ERROR, 'Failed to detect server type'));
      }

      const plugin = await this.pluginAdapter.getPlugin(typeResult.value);
      if (!plugin.ok) {
        return plugin as any;
      }

      const undeployResult = await plugin.value.undeploy(this.config, deploymentId);
      
      if (undeployResult.ok) {
        this.log.info(`Successfully undeployed ${deploymentId}`);
      } else {
        this.log.error(`Failed to undeploy ${deploymentId}: ${undeployResult.error.message}`);
      }
      
      return undeployResult;
    } catch (error) {
      return err(new JsmError(ErrorCode.UNDEPLOY_ERROR, `Undeployment failed: ${error}`, error));
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<Result<boolean, JsmError>> {
    try {
      // Detect server type from serverHome
      const typeResult = await this.pluginAdapter.detectServerType(this.config.serverHome);
      if (!typeResult.ok) {
        return err(new JsmError(ErrorCode.SERVER_TYPE_DETECTION_ERROR, 'Failed to detect server type'));
      }

      const plugin = await this.pluginAdapter.getPlugin(typeResult.value);
      if (!plugin.ok) {
        return plugin as any;
      }

      return plugin.value.healthCheck(this.config);
    } catch (error) {
      return err(new JsmError(ErrorCode.HEALTH_CHECK_ERROR, `Health check failed: ${error}`, error));
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: ServerConfig): void {
    Object.assign(this.config, newConfig);
    this.log.debug(`Configuration updated for server ${this.config.name}`);
  }

  /**
   * Get runtime information
   */
  getRuntimeInfo(): ServerRuntimeInfo | null {
    return this.runtimeInfo;
  }

  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    this.log.info(`Disposing runtime for server: ${this.config.name}`);
    
    try {
      // Stop server if running
      if (this.currentState === 'running') {
        await this.stop();
      }
      
      this.runtimeInfo = null;
      this.log.info(`Runtime disposed for server: ${this.config.name}`);
    } catch (error) {
      this.log.error(`Error disposing runtime for ${this.config.name}: ${error}`);
    }
  }

  /**
   * Helper method to extract deployment name from source path
   */
  private extractNameFromPath(sourcePath: string): string {
    return sourcePath?.split('/').pop()?.replace('.war', '') || 'deployment';
  }
}

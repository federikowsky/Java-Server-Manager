/*
 * Optimized Server Runtime Manager - Integrates new plugin architecture
 * Zero hard-coding, intelligent caching, real-time state management
 */

import { Result, ok, err } from '../../utils/result';
import { JsmError } from '../../errors/JsmError';
import { ErrorCode } from '../../errors/codes';
import { Logger } from '../../utils/logger';
import type { IServerRuntime } from '../interfaces/IServerRuntime';
import { IServerPlugin, PluginRegistry } from '../index';
// TODO: Replace PluginConfigManager with proper configuration management
// import { PluginConfigManager } from '../../config/PluginConfig';
import { SimpleCache } from '../cache/SimpleCache';
import { ServerConfig, DeploymentConfig, ServerState, ServerType } from '../../types/domain';
import { ServerStartMode } from '../../types/runtime';

/**
 * Optimized Runtime Manager with caching and new architecture
 */
export class ServerRuntimeManager {
  private static instance: ServerRuntimeManager;
  private readonly log = Logger.getInstance().createChild('ServerRuntimeManager');
  private readonly runtimes = new Map<string, IServerRuntime>();
  private readonly registry = PluginRegistry.getInstance();
  // Simple configuration object instead of PluginConfigManager
  private readonly config = { cacheExpiration: 300000 }; // 5 minutes
  private readonly cache: SimpleCache;

  private constructor() {
    // Initialize cache with configurable TTL
    this.cache = new SimpleCache(this.config.cacheExpiration);
  }

  public static getInstance(): ServerRuntimeManager {
    if (!ServerRuntimeManager.instance) {
      ServerRuntimeManager.instance = new ServerRuntimeManager();
    }
    return ServerRuntimeManager.instance;
  }

  /**
   * Register server runtime with optimized plugin loading
   */
  async register(config: ServerConfig): Promise<Result<IServerRuntime, JsmError>> {
    try {
      if (this.runtimes.has(config.id)) {
        return err(new JsmError(
          ErrorCode.RUNTIME_REGISTRATION_ERROR,
          `Runtime already registered: ${config.id}`
        ));
      }

      // Get plugin instance (cached by registry)
      const pluginResult = this.registry.get(config.type);
      if (!pluginResult.ok) {
        return pluginResult as any;
      }

      // Create optimized runtime wrapper
      const runtime = new OptimizedServerRuntime(
        config, 
        pluginResult.value,
        this.config,
        this.cache
      );
      
      this.runtimes.set(config.id, runtime);
      
      this.log.info(`Registered runtime for server: ${config.name} (${config.type})`);
      return ok(runtime);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.RUNTIME_REGISTRATION_ERROR,
        `Failed to register runtime: ${error}`,
        error
      ));
    }
  }

  /**
   * Get runtime instance with error handling
   */
  get(serverId: string): Result<IServerRuntime, JsmError> {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) {
      return err(new JsmError(
        ErrorCode.RUNTIME_CREATION_ERROR, 
        `Runtime not found: ${serverId}`
      ));
    }
    return ok(runtime);
  }

  /**
   * List all registered runtimes
   */
  list(): IServerRuntime[] {
    return Array.from(this.runtimes.values());
  }

  /**
   * Unregister runtime with cleanup
   */
  async unregister(serverId: string): Promise<Result<void, JsmError>> {
    try {
      const runtime = this.runtimes.get(serverId);
      if (runtime) {
        await runtime.dispose();
        this.runtimes.delete(serverId);
        
        // Clear related cache entries
        this.cache.invalidatePattern(`runtime:${serverId}`);
        
        this.log.info(`Unregistered runtime: ${serverId}`);
      }
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.RUNTIME_UNREGISTRATION_ERROR,
        `Failed to unregister runtime: ${error}`,
        error
      ));
    }
  }

  /**
   * Start server with enhanced error handling
   */
  async startServer(serverId: string, mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>> {
    const runtimeResult = this.get(serverId);
    if (!runtimeResult.ok) {
      return runtimeResult as any;
    }
    
    this.log.info(`Starting server ${serverId} in ${mode} mode`);
    return runtimeResult.value.start(mode, debugPort);
  }

  /**
   * Stop server with graceful shutdown
   */
  async stopServer(serverId: string): Promise<Result<void, JsmError>> {
    const runtimeResult = this.get(serverId);
    if (!runtimeResult.ok) {
      return runtimeResult as any;
    }
    
    this.log.info(`Stopping server ${serverId}`);
    return runtimeResult.value.stop();
  }

  /**
   * Restart server with mode support
   */
  async restartServer(serverId: string, mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>> {
    const runtimeResult = this.get(serverId);
    if (!runtimeResult.ok) {
      return runtimeResult as any;
    }
    
    this.log.info(`Restarting server ${serverId} in ${mode} mode`);
    return runtimeResult.value.restart(mode, debugPort);
  }

  /**
   * Stop all servers efficiently
   */
  async stopAllServers(): Promise<Result<void, JsmError>> {
    try {
      const stopPromises = this.list().map(runtime => {
        this.log.debug(`Stopping server: ${runtime.serverId}`);
        return runtime.stop();
      });
      
      await Promise.all(stopPromises);
      this.log.info(`Stopped ${stopPromises.length} servers`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.SERVER_STOP_ERROR,
        `Failed to stop all servers: ${error}`,
        error
      ));
    }
  }

  /**
   * Check if server type is supported
   */
  isTypeSupported(type: string): boolean {
    return this.registry.has(type as ServerType);
  }

  /**
   * Auto-detect server type with caching
   */
  async detectServerType(serverHome: string): Promise<Result<string, JsmError>> {
    const cacheKey = `detect:${serverHome}`;
    
    // Check cache first
    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      return ok(cached);
    }

    // Detect and cache result
    const result = await this.registry.detectServerType(serverHome);
    if (result.ok) {
      this.cache.set(cacheKey, result.value, this.config.cacheExpiration);
    }
    
    return result as any;
  }

  /**
   * Get default configuration with caching
   */
  async getDefaultConfig(type: string): Promise<Result<Partial<ServerConfig>, JsmError>> {
    const cacheKey = `defaultConfig:${type}`;
    
    // Check cache first
    const cached = this.cache.get<Partial<ServerConfig>>(cacheKey);
    if (cached) {
      return ok(cached);
    }

    // Get from plugin and cache
    const pluginResult = this.registry.get(type as ServerType);
    if (!pluginResult.ok) {
      return pluginResult as any;
    }

    const defaultConfig = pluginResult.value.getDefaultConfig();
    this.cache.set(cacheKey, defaultConfig, this.config.cacheExpiration);
    
    return ok(defaultConfig);
  }

  /**
   * Get server health with real-time checks
   */
  async getServerHealth(serverId: string): Promise<Result<boolean, JsmError>> {
    const runtimeResult = this.get(serverId);
    if (!runtimeResult.ok) {
      return runtimeResult as any;
    }
    return runtimeResult.value.healthCheck();
  }

  /**
   * Get all supported server types
   */
  getSupportedTypes(): string[] {
    return this.registry.getSupportedTypes();
  }

  /**
   * Dispose all resources
   */
  async dispose(): Promise<void> {
    this.log.info('Disposing server runtime manager...');
    
    for (const [serverId, runtime] of this.runtimes) {
      try {
        await runtime.dispose();
        this.log.debug(`Disposed runtime: ${serverId}`);
      } catch (error) {
        this.log.error(`Failed to dispose runtime ${serverId}: ${error}`);
      }
    }
    
    this.runtimes.clear();
    this.cache.dispose();
    this.log.info('Server runtime manager disposed');
  }
}

/**
 * Optimized Server Runtime - Real-time state management with caching
 */
class OptimizedServerRuntime implements IServerRuntime {
  private readonly log = Logger.getInstance().createChild('OptimizedServerRuntime');
  private currentState: ServerState = 'stopped';

  constructor(
    public readonly config: ServerConfig,
    private readonly plugin: IServerPlugin,
    private readonly runtimeConfig: { cacheExpiration: number },
    private readonly cache: SimpleCache
  ) {
    this.currentState = config.state || 'stopped';
  }

  get serverId(): string {
    return this.config.id;
  }

  /**
   * Get current server state (real-time)
   */
  getCurrentState(): ServerState {
    return this.currentState;
  }

  /**
   * Start server with enhanced monitoring
   */
  async start(mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>> {
    this.log.info(`Starting server ${this.config.name} in ${mode} mode`);
    this.currentState = 'starting';
    
    try {
      const result = await this.plugin.start(this.config, mode, debugPort);
      
      if (result.ok) {
        this.currentState = 'running';
        this.invalidateStatusCache();
        this.log.info(`Successfully started server ${this.config.name}`);
      } else {
        this.currentState = 'error';
        this.log.error(`Failed to start server ${this.config.name}: ${result.error.message}`);
      }
      
      return result;
    } catch (error) {
      this.currentState = 'error';
      return err(new JsmError(
        ErrorCode.SERVER_STARTUP_ERROR,
        `Server start failed: ${error}`,
        error
      ));
    }
  }

  /**
   * Stop server with graceful shutdown
   */
  async stop(): Promise<Result<void, JsmError>> {
    this.log.info(`Stopping server ${this.config.name}`);
    this.currentState = 'stopping';
    
    try {
      const result = await this.plugin.stop(this.config);
      
      if (result.ok) {
        this.currentState = 'stopped';
        this.invalidateStatusCache();
        this.log.info(`Successfully stopped server ${this.config.name}`);
      } else {
        this.currentState = 'error';
        this.log.error(`Failed to stop server ${this.config.name}: ${result.error.message}`);
      }
      
      return result;
    } catch (error) {
      this.currentState = 'error';
      return err(new JsmError(
        ErrorCode.SERVER_STOP_ERROR,
        `Server stop failed: ${error}`,
        error
      ));
    }
  }

  /**
   * Restart server with mode support
   */
  async restart(mode: ServerStartMode, debugPort?: number): Promise<Result<void, JsmError>> {
    this.log.info(`Restarting server ${this.config.name} in ${mode} mode`);
    
    try {
      const result = await this.plugin.restart(this.config, mode, debugPort);
      
      if (result.ok) {
        this.currentState = 'running';
        this.invalidateStatusCache();
        this.log.info(`Successfully restarted server ${this.config.name}`);
      } else {
        this.currentState = 'error';
        this.log.error(`Failed to restart server ${this.config.name}: ${result.error.message}`);
      }
      
      return result;
    } catch (error) {
      this.currentState = 'error';
      return err(new JsmError(
        ErrorCode.SERVER_RESTART_ERROR,
        `Server restart failed: ${error}`,
        error
      ));
    }
  }

  /**
   * Deploy application with caching
   */
  async deploy(deployment: DeploymentConfig): Promise<Result<void, JsmError>> {
    this.log.info(`Deploying ${deployment.name} to ${this.config.name}`);
    
    try {
      const result = await this.plugin.deploy(this.config, deployment);
      
      if (result.ok) {
        this.invalidateDeploymentCache(deployment.id);
        this.log.info(`Successfully deployed ${deployment.name}`);
      } else {
        this.log.error(`Failed to deploy ${deployment.name}: ${result.error.message}`);
      }
      
      return result;
    } catch (error) {
      return err(new JsmError(
        ErrorCode.DEPLOY_ERROR,
        `Deployment failed: ${error}`,
        error
      ));
    }
  }

  /**
   * Undeploy application
   */
  async undeploy(deploymentId: string): Promise<Result<void, JsmError>> {
    this.log.info(`Undeploying ${deploymentId} from ${this.config.name}`);
    
    try {
      const result = await this.plugin.undeploy(this.config, deploymentId);
      
      if (result.ok) {
        this.invalidateDeploymentCache(deploymentId);
        this.log.info(`Successfully undeployed ${deploymentId}`);
      } else {
        this.log.error(`Failed to undeploy ${deploymentId}: ${result.error.message}`);
      }
      
      return result;
    } catch (error) {
      return err(new JsmError(
        ErrorCode.UNDEPLOY_ERROR,
        `Undeployment failed: ${error}`,
        error
      ));
    }
  }

  /**
   * Health check with intelligent caching
   */
  async healthCheck(): Promise<Result<boolean, JsmError>> {
    const cacheKey = `health:${this.serverId}`;
    
    // Check cache first for performance
    const cached = this.cache.get<boolean>(cacheKey);
    if (cached !== undefined) {
      return ok(cached);
    }

    // Perform actual health check
    try {
      const result = await this.plugin.healthCheck(this.config);
      
      if (result.ok) {
        // Cache successful results for short time
        this.cache.set(cacheKey, result.value, this.runtimeConfig.cacheExpiration);
      }
      
      return result;
    } catch (error) {
      return err(new JsmError(
        ErrorCode.HEALTH_CHECK_ERROR,
        `Health check failed: ${error}`,
        error
      ));
    }
  }

  /**
   * Update configuration with validation
   */
  updateConfig(config: ServerConfig): void {
    this.log.info(`Updating configuration for server ${config.name}`);
    
    // Validate new configuration
    const validationResult = this.plugin.validateConfig(config);
    if (!validationResult.ok) {
      this.log.warn(`Configuration validation failed: ${validationResult.error.message}`);
      return;
    }

    // Update internal state
    Object.assign(this.config, config);
    this.invalidateStatusCache();
    
    this.log.info(`Configuration updated for server ${config.name}`);
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    this.log.info(`Disposing runtime for server: ${this.config.name}`);
    
    try {
      // Clear cache entries
      this.invalidateStatusCache();
      
      // Dispose plugin if needed
      if (this.plugin.dispose) {
        await this.plugin.dispose();
      }
      
      this.log.info(`Runtime disposed for server: ${this.config.name}`);
    } catch (error) {
      this.log.error(`Error disposing runtime for ${this.config.name}: ${error}`);
    }
  }

  /**
   * Clear status-related cache entries
   */
  private invalidateStatusCache(): void {
    this.cache.invalidatePattern(`health:${this.serverId}`);
    this.cache.invalidatePattern(`status:${this.serverId}`);
  }

  /**
   * Clear deployment-related cache entries
   */
  private invalidateDeploymentCache(deploymentId: string): void {
    this.cache.invalidatePattern(`deploy:${this.serverId}:${deploymentId}`);
  }
}

/*
 * ServerService - Event-driven facade following KISS architecture
 * Simplified approach using new ServerManager with ConfigManager persistence
 */

import { Result, ok, err } from '../core/utils/result';
import { ServerConfig, ServerState, ServerType } from '../core/types/domain';
import { ServerStartMode } from '../core/types/runtime';
import { ConfigManager } from '../core/config/ConfigManager';
import { ServerManager } from '../core/server/ServerManager';
import { PluginAdapter } from '../core/server/PluginAdapter';
import { EventBus } from '../core/EventBus';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { HookManager } from '../core/hooks/HookManager';
import { Logger } from '../core/utils/logger';
import { PidManager } from '../core/pid/PidManager';
import { DebugManager } from '../core/debug/DebugManager';

/**
 * Server Service facade using new event-driven architecture
 * Delegates to ServerManager and persists configuration changes
 */
export class ServerService {
  private readonly log = Logger.getInstance().createChild('ServerService');
  private readonly serverManager = ServerManager.getInstance();
  private readonly configManager = ConfigManager.getInstance();

  constructor(
    private readonly pidMgr: PidManager,
    private readonly bus: EventBus,
    private readonly hooks: HookManager,
    private readonly dbgMgr: DebugManager
  ) {
    // Simplified constructor - CRUD operations delegated to ConfigManager
  }

  // ==================== CRUD OPERATIONS ====================

  /**
   * Get all servers
   */
  async getAllServers(): Promise<Result<ServerConfig[], JsmError>> {
    return this.configManager.getAllServers();
  }

  /**
   * Get server by ID
   */
  async getServer(id: string): Promise<Result<ServerConfig, JsmError>> {
    return this.configManager.getServer(id);
  }

  /**
   * Get server by ID (alias for backwards compatibility)
   */
  async get(id: string): Promise<Result<ServerConfig, JsmError>> {
    return this.getServer(id);
  }

  /**
   * Get all servers (alias for backwards compatibility)
   */
  async getAll(): Promise<Result<ServerConfig[], JsmError>> {
    return this.getAllServers();
  }

  /**
   * Get server state
   */
  getServerState(id: string): Result<ServerState, JsmError> {
    return this.serverManager.getState(id);
  }

  /**
   * Create new server from config
   */
  async createFromUserInput(config: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
    try {
      // Use ConfigManager to create server
      const createResult = await this.configManager.saveServer(config);
      if (!createResult.ok) return createResult;

      const savedConfig = createResult.value;

      // Register with ServerManager to create runtime
      const registerResult = await this.serverManager.register(savedConfig);
      if (!registerResult.ok) {
        // Rollback configuration if runtime creation fails
        await this.configManager.deleteServer(savedConfig.id);
        return registerResult as any;
      }

      this.bus.emit('ServerAdded', savedConfig);
      await this.hooks.invoke('afterAddServer', savedConfig);
      this.log.info(`Server created: ${savedConfig.name} (${savedConfig.id})`);
      return ok(savedConfig);
    } catch (error) {
      return err(new JsmError(ErrorCode.PLUGIN_ERROR, `Failed to create server: ${error}`, error));
    }
  }

  /**
   * Update server from config
   */
  async updateFromUserInput(serverId: string, config: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
    try {
      // Ensure the ID matches
      config.id = serverId;
      
      // Use ConfigManager to update server
      const updateResult = await this.configManager.saveServer(config);
      if (!updateResult.ok) return updateResult;

      const updatedConfig = updateResult.value;

      // Re-register with ServerManager to update runtime
      await this.serverManager.unregister(updatedConfig.id);
      const registerResult = await this.serverManager.register(updatedConfig);
      if (!registerResult.ok) {
        return registerResult as any;
      }

      this.bus.emit('ServerUpdated', updatedConfig);
      await this.hooks.invoke('afterAddServer', config);
      this.log.info(`Server updated: ${config.name} (${config.id})`);
      return ok(config);
    } catch (error) {
      return err(new JsmError(ErrorCode.PLUGIN_ERROR, `Failed to update server: ${error}`, error));
    }
  }

  /**
   * Delete server
   */
  async delete(id: string): Promise<Result<void, JsmError>> {
    try {
      // Get server config for hooks
      const serverResult = await this.configManager.getServer(id);
      const serverConfig = serverResult.ok ? serverResult.value : undefined;

      // Stop server if running
      const stopResult = await this.serverManager.stop(id);
      if (!stopResult.ok && stopResult.error.code !== ErrorCode.SERVER_NOT_FOUND) {
        return stopResult;
      }

      // Remove from ServerManager
      const removeResult = await this.serverManager.unregister(id);
      if (!removeResult.ok) {
        return removeResult;
      }

      // Delete from ConfigManager
      const deleteResult = await this.configManager.deleteServer(id);
      if (!deleteResult.ok) {
        return deleteResult;
      }

      this.bus.emit('ServerDeleted', { id });
      if (serverConfig) {
        await this.hooks.invoke('afterDeleteServer', id);
      }
      this.log.info(`Server deleted: ${id}`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.SERVER_DELETE_ERROR, `Failed to delete server: ${error}`, error));
    }
  }

  /**
   * Start server with optional debug mode
   */
  async start(id: string, mode: 'run' | 'debug' = 'run'): Promise<Result<void, JsmError>> {
    try {
      // Get server configuration for hooks
      const serverResult = await this.configManager.getServer(id);
      if (!serverResult.ok) {
        return serverResult as any;
      }
      const server = serverResult.value;

      await this.hooks.invoke('beforeStartServer', id, mode);

      let debugPort: number | undefined;
      if (mode === 'debug') {
        debugPort = await this.dbgMgr.findFreePort();
      }

      // Start server using ServerManager
      const startMode: ServerStartMode = mode === 'debug' ? 'debug' : 'run';
      const startResult = await this.serverManager.start(id, startMode, debugPort);
      if (!startResult.ok) {
        return startResult;
      }

      // Setup debug session if in debug mode
      if (mode === 'debug' && debugPort) {
        const name = await this.dbgMgr.generateLaunchConfig(id, debugPort);
        await this.dbgMgr.attachDebugger(name);
      }

      await this.hooks.invoke('afterStartServer', id);
      this.log.info(`Started server: ${server.name} in ${mode} mode`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.SERVER_STARTUP_ERROR, `Failed to start server: ${error}`, error));
    }
  }

  /**
   * Stop server
   */
  async stop(id: string): Promise<Result<void, JsmError>> {
    try {
      // Get server configuration for hooks
      const serverResult = await this.configManager.getServer(id);
      if (!serverResult.ok) {
        return serverResult as any;
      }
      const server = serverResult.value;

      await this.hooks.invoke('beforeStopServer', id);

      const stopResult = await this.serverManager.stop(id);
      if (!stopResult.ok) {
        return stopResult;
      }

      await this.hooks.invoke('afterStopServer', id);
      this.log.info(`Stopped server: ${server.name}`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.SERVER_STOP_ERROR, `Failed to stop server: ${error}`, error));
    }
  }

  /**
   * Restart server
   */
  async restart(id: string, mode: 'run' | 'debug' = 'run'): Promise<Result<void, JsmError>> {
    try {
      // Get server configuration for hooks
      const serverResult = await this.configManager.getServer(id);
      if (!serverResult.ok) {
        return serverResult as any;
      }
      const server = serverResult.value;

      await this.hooks.invoke('beforeStopServer', id);

      let debugPort: number | undefined;
      if (mode === 'debug') {
        debugPort = await this.dbgMgr.findFreePort();
      }

      // Restart server using ServerManager
      const startMode: ServerStartMode = mode === 'debug' ? 'debug' : 'run';
      const restartResult = await this.serverManager.restart(id, startMode, debugPort);
      if (!restartResult.ok) {
        return restartResult;
      }

      // Setup debug session if in debug mode
      if (mode === 'debug' && debugPort) {
        const name = await this.dbgMgr.generateLaunchConfig(id, debugPort);
        await this.dbgMgr.attachDebugger(name);
      }

      await this.hooks.invoke('afterStartServer', id);
      this.log.info(`Restarted server: ${server.name} in ${mode} mode`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.SERVER_RESTART_ERROR, `Failed to restart server: ${error}`, error));
    }
  }

  /**
   * Get server status
   */
  async getStatus(id: string): Promise<Result<ServerState, JsmError>> {
    return this.serverManager.getState(id);
  }

  /**
   * Wait for server to reach specific status
   */
  async waitForStatus(id: string, targetStatus: ServerState, timeoutMs: number = 30000): Promise<Result<void, JsmError>> {
    return await this.serverManager.waitForStatus(id, targetStatus, timeoutMs);
  }

  /**
   * Health check for a server
   */
  async healthCheck(id: string): Promise<Result<boolean, JsmError>> {
    return await this.serverManager.healthCheck(id);
  }

  /**
   * Load workspace servers from CRUD manager
   */
  async loadWorkspace(): Promise<Result<void, JsmError>> {
    try {
      const allResult = await this.configManager.getAllServers();
      if (!allResult.ok) {
        return allResult as any;
      }

      this.log.info(`Loading ${allResult.value.length} server configurations...`);

      for (const server of allResult.value) {
        try {
          // Create runtime for each server (all start with 'stopped' state)
          const registerResult = await this.serverManager.register(server);
          if (!registerResult.ok) {
            this.log.warn(`Failed to create runtime for server ${server.name}: ${registerResult.error.message}`);
            continue;
          }

          this.log.debug(`Server ${server.name} registered with 'stopped' state`);
          this.bus.emit('ServerAdded', server);
        } catch (error) {
          this.log.error(`Error processing server ${server.name}: ${error}`);
        }
      }

      this.bus.emit('WorkspaceLoaded', { servers: allResult.value });
      this.log.info(`Workspace loaded with ${allResult.value.length} servers`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, `Failed to load workspace: ${error}`, error));
    }
  }

  /**
   * Stop all running servers
   */
  async stopAll(): Promise<void> {
    const allResult = await this.getAllServers();
    if (allResult.ok) {
      // Get all servers and check their runtime state
      for (const server of allResult.value) {
        try {
          const stateResult = this.serverManager.getState(server.id);
          if (stateResult.ok && stateResult.value === 'running') {
            await this.stop(server.id);
          }
        } catch (error) {
          this.log.error(`Failed to stop server ${server.name}: ${error}`);
        }
      }
    }
  }

  /**
   * Get running servers
   */
  async getRunning(): Promise<ServerConfig[]> {
    const allResult = await this.getAllServers();
    if (!allResult.ok) return [];

    return allResult.value.filter(server => {
      const stateResult = this.serverManager.getState(server.id);
      return stateResult.ok && stateResult.value === 'running';
    });
  }

  /**
   * Get stopped servers
   */
  async getStopped(): Promise<ServerConfig[]> {
    const allResult = await this.getAllServers();
    if (!allResult.ok) return [];

    return allResult.value.filter(server => {
      const stateResult = this.serverManager.getState(server.id);
      return stateResult.ok && stateResult.value === 'stopped';
    });
  }

  /**
   * Detect server type from server home directory
   */
  async detectServerType(serverHome: string): Promise<Result<ServerType, JsmError>> {
    const pluginAdapter = PluginAdapter.getInstance();
    return await pluginAdapter.detectServerType(serverHome);
  }

  /**
   * Get default configuration for server type
   */
  async getDefaultConfig(serverType: ServerType): Promise<Result<Partial<ServerConfig>, JsmError>> {
    const pluginAdapter = PluginAdapter.getInstance();
    return await pluginAdapter.getDefaultConfig(serverType);
  }

  /**
   * Dispose service resources
   */
  async dispose(): Promise<void> {
    this.log.info('Disposing server service...');
    try {
      await this.stopAll();
      await this.serverManager.dispose();
      this.log.info('Server service disposed');
    } catch (error) {
      this.log.error(`Error disposing server service: ${error}`);
    }
  }
}

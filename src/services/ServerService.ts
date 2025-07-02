/*
 * ServerService - KISS approach with ConfigManager
 * Integrates with runtime manager and configuration architecture
 */

import { Result, ok, err } from '../core/utils/result';
import { ServerConfig, ServerState, ServerType } from '../core/types/domain';
import { ServerStartMode } from '../core/types/runtime';
import { ConfigManager } from '../core/config/ConfigManager';
import { ServerRuntimeManager } from '../core/plugins/runtime/ServerRuntimeManager';
import { PluginRegistry } from '../core/plugins/index';
import { EventBus } from '../core/EventBus';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { HookManager } from '../core/hooks/HookManager';
import { Logger } from '../core/utils/logger';
import { PidManager } from '../core/pid/PidManager';
import { DebugManager } from '../core/debug/DebugManager';

/**
 * Server Service using ConfigManager and runtime manager
 */
export class ServerService {
  private readonly log = Logger.getInstance().createChild('ServerService');
  private readonly runtimeManager = ServerRuntimeManager.getInstance();
  private readonly pluginRegistry = PluginRegistry.getInstance();

  constructor(
    private readonly configManager: ConfigManager,
    private readonly pidMgr: PidManager,
    private readonly bus: EventBus,
    private readonly hooks: HookManager,
    private readonly dbgMgr: DebugManager
  ) {}

  /* ───────────────────────── WORKSPACE BOOT ─────────────────────── */
  
  async loadWorkspace(): Promise<Result<void, JsmError>> {
    const allResult = await this.configManager.getAllServers();
    if (!allResult.ok) {
      this.log.error('Failed to load server configurations:', allResult.error);
      return allResult as any;
    }
    
    this.log.info(`Loading ${allResult.value.length} server configurations...`);
    
    for (const server of allResult.value) {
      try {
        // Register server with runtime manager
        const registerResult = await this.runtimeManager.register(server);
        if (!registerResult.ok) {
          this.log.warn(`Failed to register server ${server.name}: ${registerResult.error.message}`);
          continue;
        }

        // Handle crash recovery
        if (server.state === 'running') {
          const pid = await this.pidMgr.read(server.pidFile);
          if (pid) {
            // Verify server is actually running
            const healthResult = await this.runtimeManager.getServerHealth(server.id);
            if (healthResult.ok && healthResult.value) {
              this.log.info(`Recovered running server ${server.name} (pid ${pid})`);
            } else {
              // Process not running, update state
              server.state = 'stopped';
              await this.configManager.saveServer(server);
              this.log.info(`Corrected state for server ${server.name} (process not running)`);
            }
          } else {
            server.state = 'stopped';
            await this.configManager.saveServer(server);
          }
        }
        
        this.bus.emit('ServerAdded', server);
      } catch (error) {
        this.log.error(`Error processing server ${server.name}: ${error}`);
      }
    }
    
    this.bus.emit('WorkspaceLoaded', { servers: allResult.value });
    this.log.info(`Workspace loaded with ${allResult.value.length} servers`);
    return ok(undefined);
  }

  /* ───────────────────────── CRUD ──────────────────────────────── */
  
  async create(draft: Partial<ServerConfig>): Promise<Result<ServerConfig, JsmError>> {
    try {
      // Auto-detect server type if not provided
      if (!draft.type && draft.serverHome) {
        const detectionResult = await this.runtimeManager.detectServerType(draft.serverHome);
        if (detectionResult.ok) {
          draft.type = detectionResult.value as ServerType;
          this.log.info(`Auto-detected server type: ${draft.type} for ${draft.name}`);
        }
      }

      // Get default configuration from plugin
      if (draft.type) {
        const defaultConfigResult = await this.runtimeManager.getDefaultConfig(draft.type);
        if (defaultConfigResult.ok) {
          // Merge defaults with provided config
          draft = { ...defaultConfigResult.value, ...draft };
        }
      }

      // Use draft as the full config (no more transformer needed)
      const fullConfig = draft as ServerConfig;
      
      // Validate configuration with plugin
      if (fullConfig.type) {
        const pluginResult = this.pluginRegistry.get(fullConfig.type);
        if (pluginResult.ok) {
          const validationResult = pluginResult.value.validateConfig(fullConfig);
          if (!validationResult.ok) {
            return validationResult as any;
          }
        }
      }

      // Save configuration using ConfigManager
      const saveResult = await this.configManager.saveServer(fullConfig);
      if (!saveResult.ok) {
        return saveResult as any;
      }

      // Register with runtime manager
      const registerResult = await this.runtimeManager.register(fullConfig);
      if (!registerResult.ok) {
        // Rollback configuration save
        await this.configManager.deleteServer(fullConfig.id);
        return registerResult as any;
      }
      
      this.bus.emit('ServerAdded', fullConfig);
      await this.hooks.invoke('afterAddServer', fullConfig);
      
      this.log.info(`Created server: ${fullConfig.name} (${fullConfig.type})`);
      return ok(fullConfig);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to create server: ${error}`,
        error
      ));
    }
  }

  async update(draft: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
    try {
      // Validate configuration with plugin
      if (draft.type) {
        const pluginResult = this.pluginRegistry.get(draft.type);
        if (pluginResult.ok) {
          const validationResult = pluginResult.value.validateConfig(draft);
          if (!validationResult.ok) {
            return validationResult as any;
          }
        }
      }

      // Save configuration using ConfigManager
      const saveResult = await this.configManager.saveServer(draft);
      if (!saveResult.ok) {
        return saveResult as any;
      }

      // Update runtime if registered
      const runtimeResult = this.runtimeManager.get(draft.id);
      if (runtimeResult.ok) {
        runtimeResult.value.updateConfig(draft);
      }
      
      this.bus.emit('ServerUpdated', draft);
      await this.hooks.invoke('afterAddServer', draft);
      
      this.log.info(`Updated server: ${draft.name}`);
      return ok(draft);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to update server: ${error}`,
        error
      ));
    }
  }

  async delete(id: string): Promise<Result<void, JsmError>> {
    try {
      // Stop server if running
      const runtimeResult = this.runtimeManager.get(id);
      if (runtimeResult.ok) {
        const stopResult = await this.runtimeManager.stopServer(id);
        if (!stopResult.ok) {
          this.log.warn(`Failed to stop server ${id} before deletion: ${stopResult.error.message}`);
        }
        
        // Unregister from runtime manager
        await this.runtimeManager.unregister(id);
      }

      // Delete configuration using ConfigManager
      const deleteResult = await this.configManager.deleteServer(id);
      if (!deleteResult.ok) {
        return deleteResult;
      }

      this.bus.emit('ServerDeleted', { id });
      await this.hooks.invoke('afterDeleteServer', id);
      
      this.log.info(`Deleted server: ${id}`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.SERVER_NOT_FOUND,
        `Failed to delete server: ${error}`,
        error
      ));
    }
  }

  get(id: string): Result<ServerConfig, JsmError> {
    // First try to get from runtime manager (most current)
    const runtimeResult = this.runtimeManager.get(id);
    if (runtimeResult.ok) {
      return ok(runtimeResult.value.config);
    }

    // Fallback to configuration manager (async version would be better)
    return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, 'Server not found in runtime manager'));
  }

  async getById(id: string): Promise<Result<ServerConfig, JsmError>> {
    return this.configManager.getServer(id);
  }

  async getAll(): Promise<Result<ServerConfig[], JsmError>> {
    // Get from runtime manager for most current state
    try {
      const runtimes = this.runtimeManager.list();
      const configs = runtimes.map(runtime => runtime.config);
      return ok(configs);
    } catch (error) {
      // Fallback to configuration manager
      return this.configManager.getAllServers();
    }
  }

  /* ───────────────────────── LIFECYCLE ─────────────────────────── */
  
  async start(id: string, mode: 'run' | 'debug'): Promise<Result<void, JsmError>> {
    try {
      await this.hooks.invoke('beforeStartServer', id, mode);
      
      // Get server configuration
      const serverResult = await this.getById(id);
      if (!serverResult.ok) {
        return serverResult as any;
      }
      const server = serverResult.value;

      let debugPort: number | undefined;
      if (mode === 'debug') {
        debugPort = await this.dbgMgr.findFreePort();
      }

      // Start server using runtime manager
      const startMode: ServerStartMode = mode === 'debug' ? 'debug' : 'run';
      const startResult = await this.runtimeManager.startServer(id, startMode, debugPort);
      if (!startResult.ok) {
        return startResult;
      }

      // Update server state
      server.state = 'running';
      const updateResult = await this.configManager.saveServer(server);
      if (!updateResult.ok) {
        this.log.warn(`Failed to update server state: ${updateResult.error.message}`);
      }

      // Setup debug session if in debug mode
      if (mode === 'debug' && debugPort) {
        const name = await this.dbgMgr.generateLaunchConfig(id, debugPort);
        await this.dbgMgr.attachDebugger(name);
      }

      this.bus.emit('ServerStateChanged', { id, state: 'running' });
      await this.hooks.invoke('afterStartServer', id);
      
      this.log.info(`Started server: ${server.name} in ${mode} mode`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.SERVER_STARTUP_ERROR,
        `Failed to start server: ${error}`,
        error
      ));
    }
  }

  async stop(id: string): Promise<Result<void, JsmError>> {
    try {
      await this.hooks.invoke('beforeStopServer', id);
      
      const serverResult = await this.getById(id);
      if (!serverResult.ok) {
        return serverResult as any;
      }
      const server = serverResult.value;

      // Stop server using runtime manager
      const stopResult = await this.runtimeManager.stopServer(id);
      if (!stopResult.ok) {
        return stopResult;
      }

      // Update server state
      server.state = 'stopped';
      const updateResult = await this.configManager.saveServer(server);
      if (!updateResult.ok) {
        this.log.warn(`Failed to update server state: ${updateResult.error.message}`);
      }

      this.bus.emit('ServerStateChanged', { id, state: 'stopped' });
      await this.hooks.invoke('afterStopServer', id);
      
      this.log.info(`Stopped server: ${server.name}`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.SERVER_STOP_ERROR,
        `Failed to stop server: ${error}`,
        error
      ));
    }
  }

  async restart(id: string, mode: 'run' | 'debug'): Promise<Result<void, JsmError>> {
    try {
      await this.hooks.invoke('beforeStopServer', id);
      
      // Get server configuration
      const serverResult = await this.getById(id);
      if (!serverResult.ok) {
        return serverResult as any;
      }
      const server = serverResult.value;

      let debugPort: number | undefined;
      if (mode === 'debug') {
        debugPort = await this.dbgMgr.findFreePort();
      }

      // Restart server using runtime manager
      const startMode: ServerStartMode = mode === 'debug' ? 'debug' : 'run';
      const restartResult = await this.runtimeManager.restartServer(id, startMode, debugPort);
      if (!restartResult.ok) {
        return restartResult;
      }

      // Update server state
      server.state = 'running';
      const updateResult = await this.configManager.saveServer(server);
      if (!updateResult.ok) {
        this.log.warn(`Failed to update server state: ${updateResult.error.message}`);
      }

      // Setup debug session if in debug mode
      if (mode === 'debug' && debugPort) {
        const name = await this.dbgMgr.generateLaunchConfig(id, debugPort);
        await this.dbgMgr.attachDebugger(name);
      }

      this.bus.emit('ServerStateChanged', { id, state: 'running' });
      await this.hooks.invoke('afterStartServer', id);
      
      this.log.info(`Restarted server: ${server.name} in ${mode} mode`);
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.SERVER_RESTART_ERROR,
        `Failed to restart server: ${error}`,
        error
      ));
    }
  }

  async stopAll(): Promise<void> {
    const allResult = await this.getAll();
    if (allResult.ok) {
      const runningServers = allResult.value.filter(s => s.state === 'running');
      for (const server of runningServers) {
        try {
          await this.stop(server.id);
        } catch (error) {
          this.log.error(`Failed to stop server ${server.name}: ${error}`);
        }
      }
    }
  }

  /* ───────────────────────── PLUGIN INTEGRATION ─────────────────────── */

  /**
   * Get server state from runtime manager
   */
  getServerState(id: string): Result<ServerState, JsmError> {
    const runtimeResult = this.runtimeManager.get(id);
    if (!runtimeResult.ok) {
      return runtimeResult as any;
    }
    
    return ok(runtimeResult.value.getCurrentState());
  }

  /**
   * Run health check for a server
   */
  async healthCheck(id: string): Promise<Result<boolean, JsmError>> {
    return this.runtimeManager.getServerHealth(id);
  }

  /**
   * Detect server type at a given path
   */
  async detectServerType(serverHome: string): Promise<Result<string, JsmError>> {
    return this.runtimeManager.detectServerType(serverHome);
  }

  /**
   * Get default configuration for a server type
   */
  async getDefaultConfig(serverType: string): Promise<Result<Partial<ServerConfig>, JsmError>> {
    return this.runtimeManager.getDefaultConfig(serverType);
  }

  /**
   * Get supported server types
   */
  getSupportedTypes(): string[] {
    return this.runtimeManager.getSupportedTypes();
  }

  /**
   * Get running servers
   */
  async getRunning(): Promise<ServerConfig[]> {
    const allResult = await this.getAll();
    return allResult.ok ? allResult.value.filter(s => s.state === 'running') : [];
  }

  /**
   * Get stopped servers
   */
  async getStopped(): Promise<ServerConfig[]> {
    const allResult = await this.getAll();
    return allResult.ok ? allResult.value.filter(s => s.state === 'stopped') : [];
  }

  /* ───────────────────────── CLEANUP ─────────────────────── */

  /**
   * Dispose service resources
   */
  async dispose(): Promise<void> {
    this.log.info('Disposing server service...');
    
    try {
      // Stop all running servers
      await this.stopAll();
      
      // Dispose runtime manager
      await this.runtimeManager.dispose();
      
      this.log.info('Server service disposed');
    } catch (error) {
      this.log.error(`Error disposing server service: ${error}`);
    }
  }
}

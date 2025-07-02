/*
 * PluginServerService - KISS approach with ConfigManager
 * Integrates with instance management and template system
 */

import { Result, ok, err } from '../core/utils/result';
import { ServerConfig, ServerState, ServerType } from '../core/types/domain';
import { ServerStartMode } from '../core/types/runtime';
import { ConfigManager } from '../core/config/ConfigManager';
import { EventBus } from '../core/EventBus';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { HookManager } from '../core/hooks/HookManager';
import { Logger } from '../core/utils/logger';
import { PidManager } from '../core/pid/PidManager';
import { DebugManager } from '../core/debug/DebugManager';
import { ServerInstanceManager } from '../core/instance/ServerInstanceManager';
import { BaseServerTemplate, CreateInstanceRequest, RegisterTemplateRequest } from '../core/types/instance';
import { ServerRuntimeManager } from '../core/plugins/runtime/ServerRuntimeManager';
import { PluginRegistry } from '../core/plugins/index';

/**
 * Plugin Server Service with clean configuration architecture
 */
export class PluginServerService {
  private readonly log = Logger.getInstance().createChild('PluginServerService');
  private readonly instanceMgr: ServerInstanceManager;
  private readonly runtimeManager = ServerRuntimeManager.getInstance();
  private readonly pluginRegistry = PluginRegistry.getInstance();
  // Simple config instead of PluginConfigManager
  private readonly pluginConfig = { cacheExpiration: 300000 };
  
  private isInitialized = false;

  constructor(
    private readonly configManager: ConfigManager,
    private readonly pidMgr: PidManager,
    private readonly bus: EventBus,
    private readonly hooks: HookManager,
    private readonly dbgMgr: DebugManager,
    extensionStoragePath: string
  ) {
    this.instanceMgr = new ServerInstanceManager(extensionStoragePath);
    this.setupEventListeners();
  }

  /* ───────────────────────── INITIALIZATION ─────────────────────── */
  
  async initialize(): Promise<Result<void, JsmError>> {
    if (this.isInitialized) {
      return ok(undefined);
    }

    try {
      this.log.info('Initializing modern plugin server service...');

      // Runtime manager and instance manager are already initialized in constructor
      
      this.isInitialized = true;
      this.log.info('Modern plugin server service initialized successfully');
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to initialize plugin server service: ${error}`,
        error
      ));
    }
  }

  /* ───────────────────────── WORKSPACE LOADING ─────────────────────── */
  
  async loadWorkspace(): Promise<Result<void, JsmError>> {
    const allResult = await this.configManager.getAllServers();
    if (!allResult.ok) {
      this.log.error('Failed to load server configurations:', allResult.error);
      return allResult as any;
    }

    this.log.info(`Loading ${allResult.value.length} server configurations...`);

    // Register all servers with runtime manager
    for (const serverConfig of allResult.value) {
      try {
        // Check if server type is supported
        if (!this.runtimeManager.isTypeSupported(serverConfig.type)) {
          this.log.warn(`Unsupported server type: ${serverConfig.type} for server: ${serverConfig.name}`);
          continue;
        }

        // Register with runtime manager
        const registerResult = await this.runtimeManager.register(serverConfig);
        if (!registerResult.ok) {
          this.log.warn(`Failed to register server ${serverConfig.name}: ${registerResult.error.message}`);
          continue;
        }

        // Handle crash recovery
        if (serverConfig.state === 'running') {
          const pid = await this.pidMgr.read(serverConfig.pidFile);
          if (pid) {
            const healthResult = await this.runtimeManager.getServerHealth(serverConfig.id);
            if (healthResult.ok && healthResult.value) {
              this.log.info(`Recovered running server ${serverConfig.name} (pid ${pid})`);
            } else {
              // Process not running, update state
              serverConfig.state = 'stopped';
              await this.configManager.saveServer(serverConfig);
              this.log.info(`Corrected state for server ${serverConfig.name} (process not running)`);
            }
          } else {
            serverConfig.state = 'stopped';
            await this.configManager.saveServer(serverConfig);
          }
        }

        this.bus.emit('ServerAdded', serverConfig);
      } catch (error) {
        this.log.error(`Error processing server ${serverConfig.name}: ${error}`);
      }
    }

    this.log.info(`Workspace loaded with ${allResult.value.length} servers`);
    return ok(undefined);
  }

  /* ───────────────────────── CRUD ──────────────────────────────── */

  async create(cfg: Partial<ServerConfig>): Promise<Result<ServerConfig, JsmError>> {
    try {
      // Auto-detect server type if not provided
      if (!cfg.type && cfg.serverHome) {
        const detectionResult = await this.runtimeManager.detectServerType(cfg.serverHome);
        if (detectionResult.ok) {
          cfg.type = detectionResult.value as ServerType;
          this.log.info(`Auto-detected server type: ${cfg.type} for ${cfg.name}`);
        }
      }

      // Get default configuration from plugin
      if (cfg.type) {
        const defaultConfigResult = await this.runtimeManager.getDefaultConfig(cfg.type);
        if (defaultConfigResult.ok) {
          // Merge defaults with provided config
          cfg = { ...defaultConfigResult.value, ...cfg };
        }
      }

      // Simple config transformation
      const fullConfig: ServerConfig = {
        id: cfg.id || `server_${Date.now()}`,
        name: cfg.name || 'New Server',
        type: cfg.type || 'tomcat',
        serverHome: cfg.serverHome || '',
        javaHome: cfg.javaHome || process.env.JAVA_HOME || '',
        host: cfg.host || 'localhost',
        port: cfg.port || 8080,
        state: 'stopped',
        autoSync: cfg.autoSync !== undefined ? cfg.autoSync : true,
        deployments: cfg.deployments || [],
        pidFile: cfg.pidFile || '',
        debug: cfg.debug || { enable: false },
        ...cfg
      };

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

      // Check for duplicate names
      const nameCheck = await this.isServerNameAvailable(fullConfig.name);
      if (!nameCheck.ok) {
        return nameCheck as any;
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

      // Execute hooks
      await this.hooks.invoke('afterAddServer', fullConfig);
      
      // Emit event
      this.bus.emit('ServerAdded', fullConfig);
      
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

  get(id: string): Result<ServerConfig, JsmError> {
    const runtimeResult = this.runtimeManager.get(id);
    if (!runtimeResult.ok) {
      return runtimeResult as any;
    }
    
    return ok(runtimeResult.value.config);
  }

  async getAll(): Promise<Result<ServerConfig[], JsmError>> {
    try {
      const runtimes = this.runtimeManager.list();
      const configs = runtimes.map(runtime => runtime.config);
      return ok(configs);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.SERVER_NOT_FOUND,
        `Failed to get all servers: ${error}`,
        error
      ));
    }
  }

  async update(id: string, changes: Partial<ServerConfig>): Promise<Result<ServerConfig, JsmError>> {
    try {
      // Get current configuration
      const currentResult = this.get(id);
      if (!currentResult.ok) {
        return currentResult;
      }

      // Merge changes
      const updated = { ...currentResult.value, ...changes };

      // Validate with plugin
      if (updated.type) {
        const pluginResult = this.pluginRegistry.get(updated.type);
        if (pluginResult.ok) {
          const validationResult = pluginResult.value.validateConfig(updated);
          if (!validationResult.ok) {
            return validationResult as any;
          }
        }
      }

      // Save configuration using ConfigManager
      const saveResult = await this.configManager.saveServer(updated);
      if (!saveResult.ok) {
        return saveResult as any;
      }

      // Update runtime
      const runtimeResult = this.runtimeManager.get(id);
      if (runtimeResult.ok) {
        runtimeResult.value.updateConfig(updated);
      }

      // Execute hooks (update hooks don't exist in schema, using after add)
      await this.hooks.invoke('afterAddServer', updated);
      
      // Emit event
      this.bus.emit('ServerUpdated', updated);
      
      this.log.info(`Updated server: ${updated.name}`);
      return ok(updated);
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
          this.log.warn(`Failed to stop server before deletion: ${stopResult.error.message}`);
        }
        
        // Unregister from runtime
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

  /* ───────────────────────── LIFECYCLE ─────────────────────── */

  async start(id: string, mode: 'run' | 'debug' = 'run'): Promise<Result<void, JsmError>> {
    return this.runtimeManager.startServer(id, mode);
  }

  async stop(id: string): Promise<Result<void, JsmError>> {
    return this.runtimeManager.stopServer(id);
  }

  async restart(id: string, mode: 'run' | 'debug' = 'run'): Promise<Result<void, JsmError>> {
    return this.runtimeManager.restartServer(id, mode);
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

  /* ───────────────────────── TEMPLATE & INSTANCE MANAGEMENT ─────────────────────── */

  async registerTemplate(request: RegisterTemplateRequest): Promise<Result<BaseServerTemplate, JsmError>> {
    return this.instanceMgr.registerTemplate(request);
  }

  async createInstance(request: CreateInstanceRequest): Promise<Result<ServerConfig, JsmError>> {
    const instanceResult = await this.instanceMgr.createInstance(request);
    if (!instanceResult.ok) {
      return instanceResult as any;
    }

    // Register the instance as a regular server
    return this.create(instanceResult.value.config);
  }

  async getTemplates(): Promise<Result<BaseServerTemplate[], JsmError>> {
    try {
      const templates = this.instanceMgr.getTemplates();
      return ok(templates);
    } catch (error) {
      return err(new JsmError(
        ErrorCode.TEMPLATE_NOT_FOUND,
        `Failed to get templates: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      ));
    }
  }

  /* ───────────────────────── HELPERS ─────────────────────── */

  private async isServerNameAvailable(name: string): Promise<Result<void, JsmError>> {
    const allResult = await this.getAll();
    if (!allResult.ok) {
      return allResult as any;
    }

    const exists = allResult.value.some(s => s.name === name);
    if (exists) {
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Server name '${name}' already exists`
      ));
    }

    return ok(undefined);
  }

  private setupEventListeners(): void {
    // Listen for plugin events and forward as needed
    this.bus.on('ServerStateChanged', (event: any) => {
      this.log.debug(`Server state changed: ${event.id} -> ${event.state}`);
    });
  }

  /* ───────────────────────── CLEANUP ─────────────────────── */

  async dispose(): Promise<void> {
    this.log.info('Disposing modern plugin server service...');
    
    try {
      // Stop all servers
      await this.stopAll();
      
      // Dispose runtime manager
      await this.runtimeManager.dispose();
      
      this.log.info('Modern plugin server service disposed');
    } catch (error) {
      this.log.error(`Error disposing plugin server service: ${error}`);
    }
  }
}

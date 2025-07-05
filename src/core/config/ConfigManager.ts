/*
 * src/core/config/ConfigManager.ts
 * ULTRA-SIMPLIFIED Configuration Manager - Pure KISS approach
 */

import * as fs from 'fs';
import * as path from 'path';
import { workspace, FileSystemWatcher, Disposable, RelativePattern } from 'vscode';
import { ServerConfig } from '../types/domain';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { EventBus } from '../EventBus';
import { ValidationManager } from './schema/ValidationManager';

interface ConfigFile {
  servers: ServerConfig[];
}

/**
 * ULTRA-SIMPLIFIED Configuration Manager - Pure KISS principle
 * Only essential operations: read/write servers from JSON file
 */
export class ConfigManager {
  private static instance: ConfigManager | null = null;
  private configPath: string = '';
  private servers: ServerConfig[] = [];
  private fileWatcher: FileSystemWatcher | null = null;
  private eventBus: EventBus;
  private debounceTimer: NodeJS.Timeout | null = null;
  private validationManager: ValidationManager;

  private constructor() {
    this.eventBus = EventBus.getInstance();
    this.validationManager = ValidationManager.getInstance();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  static async initialize(workspaceUri: any): Promise<Result<void, JsmError>> {
    const instance = ConfigManager.getInstance();
    const workspacePath = workspaceUri.fsPath || workspaceUri.path;
    
    instance.configPath = path.join(workspacePath, '.vscode', 'servers.json');
    
    // Ensure directory exists
    const configDir = path.dirname(instance.configPath);
    if (!fs.existsSync(configDir)) {
      await fs.promises.mkdir(configDir, { recursive: true });
    }
    
    // Load servers into memory
    await instance.loadFromFile();
    
    // Setup file watching
    instance.setupFileWatcher();
    
    return ok(undefined);
  }

  // ==================== CORE OPERATIONS ====================

  /**
   * Get the validation manager instance
   */
  getValidationManager(): ValidationManager {
    return this.validationManager;
  }

  /**
   * Validate a server configuration without saving
   */
  async validateServer(config: ServerConfig): Promise<Result<void, JsmError>> {
    // Step 1: Validate against JSON schema using ValidationManager
    const schemaResult = this.validationManager.validateServer(config);
    if (!schemaResult.ok) {
      return schemaResult;
    }

    // Step 2: Check for unique names within existing servers
    const existingServer = this.servers.find(s => s.name === config.name && s.id !== config.id);
    if (existingServer) {
      return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, `Server name '${config.name}' already exists. Server names must be unique.`));
    }

    // Step 3: Validate paths exist (business logic validation)
    try {
      if (!fs.existsSync(config.serverHome)) {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, `Server home path does not exist: ${config.serverHome}`));
      }
      if (!fs.existsSync(config.javaHome)) {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, `Java home path does not exist: ${config.javaHome}`));
      }
    } catch (error) {
      return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, `Path validation error: ${error}`));
    }

    return ok(undefined);
  }

  async getAllServers(): Promise<Result<ServerConfig[], JsmError>> {
    return ok([...this.servers]);
  }

  getServer(id: string): Result<ServerConfig, JsmError> {
    const server = this.servers.find(s => s.id === id);
    if (!server) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${id} not found`));
    }
    return ok(server);
  }

  async saveServer(config: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
    // Validate the server configuration
    const validationResult = await this.validateServer(config);
    if (!validationResult.ok) {
      return validationResult as any;
    }

    // Find existing or add new
    const index = this.servers.findIndex(s => s.id === config.id);
    if (index >= 0) {
      this.servers[index] = config;
    } else {
      this.servers.push(config);
    }

    const saveResult = await this.saveToFile();
    if (!saveResult.ok) return saveResult as any;

    return ok(config);
  }

  async deleteServer(id: string): Promise<Result<void, JsmError>> {
    const initialLength = this.servers.length;
    this.servers = this.servers.filter(s => s.id !== id);
    
    if (this.servers.length === initialLength) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${id} not found`));
    }

    const saveResult = await this.saveToFile();
    if (!saveResult.ok) return saveResult as any;

    return ok(undefined);
  }

  // ==================== FILE OPERATIONS ====================

  private async loadFromFile(): Promise<Result<void, JsmError>> {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.servers = [];
        return ok(undefined);
      }

      const content = await fs.promises.readFile(this.configPath, 'utf8');
      const rawConfig = JSON.parse(content);
      
      // Validate JSON against schema
      const validationResult = this.validationManager.validateWithUniqueNames(rawConfig);
      if (!validationResult.ok) {
        return err(new JsmError(ErrorCode.CONFIG_INVALID, 
          `Configuration file validation failed: ${validationResult.error.message}`));
      }

      const config = rawConfig as ConfigFile;
      
      // Load servers - state is now managed only in runtime, not in configuration
      this.servers = Array.isArray(config.servers) ? config.servers : [];
        
      return ok(undefined);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return err(new JsmError(ErrorCode.CONFIG_INVALID, `Invalid JSON in configuration file: ${error.message}`));
      }
      return err(new JsmError(ErrorCode.FS_READ, `Failed to load config: ${error}`));
    }
  }

  private async saveToFile(): Promise<Result<void, JsmError>> {
    try {
      const config: ConfigFile = { servers: this.servers };
      
      // Validate configuration before saving
      const validationResult = this.validationManager.validateWithUniqueNames(config);
      if (!validationResult.ok) {
        return err(new JsmError(ErrorCode.CONFIG_INVALID, 
          `Cannot save invalid configuration: ${validationResult.error.message}`));
      }
      
      const content = JSON.stringify(config, null, 2);
      await fs.promises.writeFile(this.configPath, content, 'utf8');
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.FS_WRITE, `Failed to save config: ${error}`));
    }
  }

  // ==================== FILE WATCHING ====================

  private setupFileWatcher(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }

    // Create watcher for the specific servers.json file
    const pattern = new RelativePattern(
      path.dirname(this.configPath), 
      'servers.json'
    );
    
    this.fileWatcher = workspace.createFileSystemWatcher(pattern);
    
    // Watch for file changes with debouncing to prevent excessive events
    this.fileWatcher.onDidChange(() => {
      this.debouncedFileChanged();
    });
    
    this.fileWatcher.onDidCreate(() => {
      this.debouncedFileChanged();
    });
    
    this.fileWatcher.onDidDelete(() => {
      this.debouncedFileChanged();
    });
  }

  private debouncedFileChanged(): void {
    // Clear any existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    // Set new timer for 500ms debounce
    this.debounceTimer = setTimeout(async () => {
      await this.handleFileChanged();
    }, 500);
  }

  private async handleFileChanged(): Promise<void> {
    try {
      // Reload configuration from file
      const loadResult = await this.loadFromFile();
      if (loadResult.ok) {
        // Emit ConfigChanged event to notify other components
        this.eventBus.emit('ConfigChanged', {
          source: 'file',
          servers: [...this.servers]
        });
        console.log('🔄 Configuration reloaded from file - emitted ConfigChanged event');
      } else {
        console.error('❌ Failed to reload configuration after file change:', loadResult.error);
      }
    } catch (error) {
      console.error('❌ Error handling file change:', error);
    }
  }

  // ==================== COMPATIBILITY ====================

  async dispose(): Promise<void> {
    // Clean up file watcher
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }
    
    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    // Ultra-simplified: clear servers
    this.servers = [];
  }

  // Deployment compatibility methods using core operations
  async addDeployment(serverId: string, deployment: any): Promise<Result<any, JsmError>> {
    const serverResult = this.getServer(serverId);
    if (!serverResult.ok) return serverResult as any;
    
    const server = serverResult.value;
    if (!server.deployments) server.deployments = [];
    server.deployments.push(deployment);
    
    const saveResult = await this.saveServer(server);
    return saveResult.ok ? ok(deployment) : saveResult as any;
  }

  async deleteDeployment(serverId: string, deploymentId: string): Promise<Result<void, JsmError>> {
    const serverResult = this.getServer(serverId);
    if (!serverResult.ok) return serverResult as any;
    
    const server = serverResult.value;
    if (!server.deployments) server.deployments = [];
    
    const initialLength = server.deployments.length;
    server.deployments = server.deployments.filter(d => d.id !== deploymentId);
    
    if (server.deployments.length === initialLength) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Deployment ${deploymentId} not found`));
    }
    
    const saveResult = await this.saveServer(server);
    return saveResult.ok ? ok(undefined) : saveResult as any;
  }

  async updateDeployment(serverId: string, deploymentId: string, deployment: any): Promise<Result<any, JsmError>> {
    const serverResult = this.getServer(serverId);
    if (!serverResult.ok) return serverResult as any;
    
    const server = serverResult.value;
    if (!server.deployments) server.deployments = [];
    
    const index = server.deployments.findIndex(d => d.id === deploymentId);
    if (index === -1) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Deployment ${deploymentId} not found`));
    }
    
    server.deployments[index] = deployment;
    const saveResult = await this.saveServer(server);
    return saveResult.ok ? ok(deployment) : saveResult as any;
  }
}

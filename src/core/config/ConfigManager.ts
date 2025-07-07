/*
 * src/core/config/ConfigManager.ts
 * ULTRA-SIMPLIFIED Configuration Manager - Pure KISS approach
 * ONLY file watching and event coordination - delegates all CRUD to ServerController
 */

import * as path from 'path';
import { workspace, FileSystemWatcher, RelativePattern } from 'vscode';
import { ServerConfig } from '../types/domain';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { EventBus } from '../EventBus';
import { ConfigRepo } from '../persistence/ConfigRepo';
import { ServerController } from '../controllers/ServerController';

/**
 * ULTRA-SIMPLIFIED Configuration Manager - File watching + event coordination
 * All CRUD operations delegated to ServerController following SRP
 */
export class ConfigManager {
  private static instance: ConfigManager | null = null;
  private fileWatcher: FileSystemWatcher | null = null;
  private eventBus: EventBus;
  private debounceTimer: NodeJS.Timeout | null = null;
  private repo: ConfigRepo;
  private controller: ServerController;

  private constructor() {
    this.eventBus = EventBus.getInstance();
    this.repo = ConfigRepo.getInstance();
    this.controller = ServerController.getInstance();
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
    
    // Initialize repository
    const initResult = await instance.repo.initialize(workspacePath);
    if (!initResult.ok) {
      return initResult;
    }
    
    // Setup file watching
    instance.setupFileWatcher(workspacePath);
    
    return ok(undefined);
  }

  // ==================== CRUD DELEGATION ====================

  /**
   * All CRUD operations delegated to ServerController
   */
  async getAllServers(): Promise<Result<ServerConfig[], JsmError>> {
    return this.controller.getAll();
  }

  async getServer(id: string): Promise<Result<ServerConfig, JsmError>> {
    return this.controller.get(id);
  }

  async saveServer(config: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
    if (config.id && this.controller.exists(config.id)) {
      return this.controller.update(config.id, config);
    } else {
      return this.controller.create(config);
    }
  }

  async deleteServer(id: string): Promise<Result<void, JsmError>> {
    return this.controller.delete(id);
  }

  async validateServer(config: ServerConfig): Promise<Result<void, JsmError>> {
    return this.controller.validateOnly(config);
  }

  // ==================== FILE WATCHING ====================

  private setupFileWatcher(workspacePath: string): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }

    const configPath = path.join(workspacePath, '.vscode', 'servers.json');
    const pattern = new RelativePattern(
      path.dirname(configPath), 
      'servers.json'
    );
    
    this.fileWatcher = workspace.createFileSystemWatcher(pattern);
    
    this.fileWatcher.onDidChange(() => this.debouncedFileChanged());
    this.fileWatcher.onDidCreate(() => this.debouncedFileChanged());
    this.fileWatcher.onDidDelete(() => this.debouncedFileChanged());
  }

  private debouncedFileChanged(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(async () => {
      await this.handleFileChanged();
    }, 500);
  }

  private async handleFileChanged(): Promise<void> {
    try {
      const loadResult = await this.repo.load();
      if (loadResult.ok) {
        this.eventBus.emit('ConfigChanged', {
          source: 'file',
          servers: loadResult.value
        });
        console.log('🔄 Configuration reloaded from file');
      } else {
        console.error('❌ Failed to reload configuration:', loadResult.error);
      }
    } catch (error) {
      console.error('❌ Error handling file change:', error);
    }
  }

  // ==================== COMPATIBILITY & CLEANUP ====================

  async dispose(): Promise<void> {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // Deployment compatibility methods - delegated to controller
  async addDeployment(serverId: string, deployment: any): Promise<Result<any, JsmError>> {
    const serverResult = await this.getServer(serverId);
    if (!serverResult.ok) return serverResult as any;
    
    const server = serverResult.value;
    if (!server.deployments) server.deployments = [];
    server.deployments.push(deployment);
    
    const saveResult = await this.saveServer(server);
    return saveResult.ok ? ok(deployment) : saveResult as any;
  }

  async deleteDeployment(serverId: string, deploymentId: string): Promise<Result<void, JsmError>> {
    const serverResult = await this.getServer(serverId);
    if (!serverResult.ok) return serverResult as any;
    
    const server = serverResult.value;
    if (!server.deployments) server.deployments = [];
    
    const initialLength = server.deployments.length;
    server.deployments = server.deployments.filter((d: any) => d.id !== deploymentId);
    
    if (server.deployments.length === initialLength) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Deployment ${deploymentId} not found`));
    }
    
    const saveResult = await this.saveServer(server);
    return saveResult.ok ? ok(undefined) : saveResult as any;
  }

  async updateDeployment(serverId: string, deploymentId: string, deployment: any): Promise<Result<any, JsmError>> {
    const serverResult = await this.getServer(serverId);
    if (!serverResult.ok) return serverResult as any;
    
    const server = serverResult.value;
    if (!server.deployments) server.deployments = [];
    
    const index = server.deployments.findIndex((d: any) => d.id === deploymentId);
    if (index === -1) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Deployment ${deploymentId} not found`));
    }
    
    server.deployments[index] = deployment;
    const saveResult = await this.saveServer(server);
    return saveResult.ok ? ok(deployment) : saveResult as any;
  }
}

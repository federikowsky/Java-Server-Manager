/*
 * src/core/config/ConfigManager.ts
 * ULTRA-SIMPLIFIED Configuration Manager - Pure KISS approach
 */

import * as fs from 'fs';
import * as path from 'path';
import { ServerConfig } from '../types/domain';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';

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

  private constructor() {}

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
    
    return ok(undefined);
  }

  // ==================== CORE OPERATIONS ====================

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
    // Basic validation
    if (!config.id || !config.name || !config.serverHome) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, 'Missing required fields: id, name, serverHome'));
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
      const config = JSON.parse(content) as ConfigFile;
      
      this.servers = Array.isArray(config.servers) ? config.servers : [];
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.FS_READ, `Failed to load config: ${error}`));
    }
  }

  private async saveToFile(): Promise<Result<void, JsmError>> {
    try {
      const config: ConfigFile = { servers: this.servers };
      const content = JSON.stringify(config, null, 2);
      await fs.promises.writeFile(this.configPath, content, 'utf8');
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.FS_WRITE, `Failed to save config: ${error}`));
    }
  }

  // ==================== COMPATIBILITY ====================

  async dispose(): Promise<void> {
    // Ultra-simplified: nothing to dispose
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

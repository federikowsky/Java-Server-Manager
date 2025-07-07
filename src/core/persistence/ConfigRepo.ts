/*
 * src/core/persistence/ConfigRepo.ts
 * ULTRA-PURE Repository - Single Responsibility: File I/O Only
 * ZERO validation, ZERO business logic, ONLY file operations
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
 * Pure File Repository - Single Responsibility: JSON File Persistence
 * ONLY handles reading/writing JSON files - ZERO business logic
 * Optimized with Map for O(1) lookups
 */
export class ConfigRepo {
  private static instance: ConfigRepo | null = null;
  private configPath: string = '';
  private cachedServers: Map<string, ServerConfig> = new Map();

  private constructor() {}

  static getInstance(): ConfigRepo {
    if (!ConfigRepo.instance) {
      ConfigRepo.instance = new ConfigRepo();
    }
    return ConfigRepo.instance;
  }

  /**
   * Initialize repository with workspace path
   */
  async initialize(workspacePath: string): Promise<Result<void, JsmError>> {
    this.configPath = path.join(workspacePath, '.vscode', 'servers.json');
    
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      await fs.promises.mkdir(configDir, { recursive: true });
    }

    const loadResult = await this.load();
    return loadResult.ok ? ok(undefined) : loadResult as any;
  }

  /**
   * Load servers from file - Pure I/O operation
   */
  async load(): Promise<Result<ServerConfig[], JsmError>> {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.cachedServers.clear();
        return ok([]);
      }

      const content = await fs.promises.readFile(this.configPath, 'utf8');
      const config = JSON.parse(content) as ConfigFile;
      
      // Convert array to Map for O(1) lookups
      this.cachedServers.clear();
      const servers = Array.isArray(config.servers) ? config.servers : [];
      servers.forEach(server => {
        if (server.id) {
          this.cachedServers.set(server.id, server);
        }
      });
      
      return ok(servers);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return err(new JsmError(ErrorCode.CONFIG_INVALID, `Invalid JSON: ${error.message}`));
      }
      return err(new JsmError(ErrorCode.FS_READ, `Failed to load config: ${error}`));
    }
  }

  /**
   * Save servers to file - Pure I/O operation  
   */
  async save(servers: ServerConfig[]): Promise<Result<void, JsmError>> {
    try {
      const config: ConfigFile = { servers };
      const content = JSON.stringify(config, null, 2);
      
      await fs.promises.writeFile(this.configPath, content, 'utf8');
      
      // Update cache Map
      this.cachedServers.clear();
      servers.forEach(server => {
        if (server.id) {
          this.cachedServers.set(server.id, server);
        }
      });
      
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.FS_WRITE, `Failed to save config: ${error}`));
    }
  }

  /**
   * Get server by ID - O(1) Memory operation
   */
  getById(id: string): ServerConfig | null {
    return this.cachedServers.get(id) || null;
  }

  /**
   * Get all servers - Memory operation
   */
  getAll(): ServerConfig[] {
    return Array.from(this.cachedServers.values());
  }

  /**
   * Check if server exists - O(1) Memory operation
   */
  exists(id: string): boolean {
    return this.cachedServers.has(id);
  }

  /**
   * Check if server name exists - O(n) Memory operation
   */
  nameExists(name: string, excludeId?: string): boolean {
    for (const [id, server] of this.cachedServers) {
      if (server.name === name && id !== excludeId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Add server and save - Combined operation
   */
  async add(server: ServerConfig): Promise<Result<void, JsmError>> {
    if (!server.id) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, 'Server ID is required'));
    }
    
    const allServers = this.getAll();
    allServers.push(server);
    return await this.save(allServers);
  }

  /**
   * Update server and save - Combined operation
   */
  async update(server: ServerConfig): Promise<Result<void, JsmError>> {
    if (!server.id) {
      return err(new JsmError(ErrorCode.CONFIG_INVALID, 'Server ID is required'));
    }
    
    if (!this.cachedServers.has(server.id)) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${server.id} not found`));
    }

    const allServers = this.getAll();
    const index = allServers.findIndex(s => s.id === server.id);
    allServers[index] = server;
    
    return await this.save(allServers);
  }

  /**
   * Remove server and save - Combined operation
   */
  async remove(id: string): Promise<Result<void, JsmError>> {
    if (!this.cachedServers.has(id)) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${id} not found`));
    }

    const allServers = this.getAll().filter(s => s.id !== id);
    return await this.save(allServers);
  }
}

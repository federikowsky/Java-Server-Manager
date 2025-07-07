/*
 * src/core/controllers/ServerController.ts
 * ULTRA-PURE Controller - Single Responsibility: CRUD Coordination
 * ZERO business logic, ONLY delegates to specialized classes
 */

import { ServerConfig } from '../types/domain';
import { ConfigRepo } from '../persistence/ConfigRepo';
import { SchemaValidator } from '../validation/SchemaValidator';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';

/**
 * Pure CRUD Controller - Single Responsibility: Coordinate Operations
 * ONLY coordinates between repo and validator - ZERO business logic
 */
export class ServerController {
  private static instance: ServerController | null = null;
  private repo: ConfigRepo;
  private validator: SchemaValidator;

  private constructor() {
    this.repo = ConfigRepo.getInstance();
    this.validator = SchemaValidator.getInstance();
  }

  static getInstance(): ServerController {
    if (!ServerController.instance) {
      ServerController.instance = new ServerController();
    }
    return ServerController.instance;
  }

  /**
   * Create new server - SIMPLIFIED flow
   */
  async create(config: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
    // Step 1: Generate ID if not present
    if (!config.id) {
      config.id = this.generateServerId(config.name);
    }

    // Step 2: Ensure deployments array
    if (!config.deployments) {
      config.deployments = [];
    }

    // Step 3: Validate schema
    const schemaResult = this.validator.validateServer(config);
    if (!schemaResult.ok) {
      return schemaResult as any;
    }

    // Step 4: Check unique name
    if (this.repo.nameExists(config.name)) {
      return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, 
        `Server name '${config.name}' already exists`));
    }

    // Step 5: Save to repo
    const saveResult = await this.repo.add(config);
    if (!saveResult.ok) {
      return saveResult as any;
    }

    return ok(config);
  }

  /**
   * Update existing server - SIMPLIFIED flow
   */
  async update(id: string, config: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
    // Step 1: Get existing server
    const existing = this.repo.getById(id);
    if (!existing) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${id} not found`));
    }

    // Step 2: Preserve system fields
    config.id = existing.id;
    config.deployments = existing.deployments || [];

    // Step 3: Validate schema
    const schemaResult = this.validator.validateServer(config);
    if (!schemaResult.ok) {
      return schemaResult as any;
    }

    // Step 4: Check unique name (excluding current)
    if (this.repo.nameExists(config.name, config.id)) {
      return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, 
        `Server name '${config.name}' already exists`));
    }

    // Step 5: Save to repo
    const saveResult = await this.repo.update(config);
    if (!saveResult.ok) {
      return saveResult as any;
    }

    return ok(config);
  }

  /**
   * Delete server
   */
  async delete(id: string): Promise<Result<void, JsmError>> {
    return await this.repo.remove(id);
  }

  /**
   * Get server by ID
   */
  async get(id: string): Promise<Result<ServerConfig, JsmError>> {
    const server = this.repo.getById(id);
    if (!server) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${id} not found`));
    }
    return ok(server);
  }

  /**
   * Get all servers
   */
  async getAll(): Promise<Result<ServerConfig[], JsmError>> {
    const servers = this.repo.getAll();
    return ok(servers);
  }

  /**
   * Check if server exists
   */
  exists(id: string): boolean {
    return this.repo.exists(id);
  }

  /**
   * Validate server config without saving
   */
  validateOnly(config: ServerConfig): Result<void, JsmError> {
    // Schema validation
    const schemaResult = this.validator.validateServer(config);
    if (!schemaResult.ok) {
      return schemaResult;
    }

    // Unique name check
    if (this.repo.nameExists(config.name, config.id)) {
      return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, 
        `Server name '${config.name}' already exists`));
    }

    return ok(undefined);
  }

  /**
   * Generate unique server ID - name + timestamp
   */
  private generateServerId(name: string): string {
    const timestamp = Date.now();
    const cleanName = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return `${cleanName}-${timestamp}`;
  }
}

import type {
  ServerConfig,
  DeploymentConfig,
  ServerId,
  DeploymentId,
  Logger,
} from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { EventBus } from '@core/events/EventBus';
import type { SchemaValidator } from '@core/validation/SchemaValidator';
import type { ConfigRepo } from '@infra/fs/ConfigRepo';
import { requireWorkspaceTrust, validateSecurityPolicy } from '@core/policy';
import type { TrustGate } from '@core/types/runtime';

function deploymentPersistedChanged(before: DeploymentConfig, after: DeploymentConfig): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/**
 * Application-level config service (§5.5).
 * Orchestrates ConfigRepo + SchemaValidator + EventBus for server CRUD.
 */
export class ConfigService {
  private readonly repo: ConfigRepo;
  private readonly validator: SchemaValidator;
  private readonly bus: EventBus;
  private readonly logger: Logger;
  private readonly workspaceFolderUri: string;
  private readonly trustGate?: TrustGate;

  constructor(deps: {
    repo: ConfigRepo;
    validator: SchemaValidator;
    bus: EventBus;
    logger: Logger;
    workspaceFolderUri: string;
    trustGate?: TrustGate;
  }) {
    this.repo = deps.repo;
    this.validator = deps.validator;
    this.bus = deps.bus;
    this.logger = deps.logger;
    this.workspaceFolderUri = deps.workspaceFolderUri;
    this.trustGate = deps.trustGate;
  }

  /**
   * Load workspace config.
   * Returns all loaded server configs.
   */
  async loadWorkspace(): Promise<Result<ServerConfig[], JsmError>> {
    const loadResult = await this.repo.load();
    if (!loadResult.ok) return loadResult;

    const servers = loadResult.value;
    this.logger.info(`ConfigService: loaded ${servers.length} servers`);
    return ok(servers);
  }

  /** Get a single server by ID. */
  getServer(serverId: ServerId): ServerConfig | undefined {
    return this.repo.get(serverId);
  }

  /** Get all servers. */
  getAllServers(): ServerConfig[] {
    return this.repo.getAll();
  }

  /** Add a new server, validate, persist, and emit event. */
  async addServer(config: ServerConfig): Promise<Result<void, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'modify server inventory');
    if (!trustResult.ok) return trustResult;

    // Check for duplicate ID
    if (this.repo.get(config.id)) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Server with ID '${config.id}' already exists`,
      }));
    }

    // Security policy validation (§12.9)
    const securityResult = validateSecurityPolicy(config);
    if (!securityResult.ok) return securityResult;

    // Schema validation
    const validResult = this.validator.validate(config, 'server-config');
    if (!validResult.ok) return validResult;

    const saveResult = await this.repo.save(config);
    if (!saveResult.ok) return saveResult;

    this.bus.emit('ServerAdded', { serverId: config.id, workspaceFolderUri: this.workspaceFolderUri });
    this.logger.info(`ConfigService: added server '${config.name}'`);
    return ok(undefined);
  }

  /** Update an existing server, validate, persist, and emit event. */
  async updateServer(config: ServerConfig): Promise<Result<void, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'modify server inventory');
    if (!trustResult.ok) return trustResult;

    const previous = this.repo.get(config.id);
    if (!previous) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Server '${config.id}' not found`,
      }));
    }

    const securityResult = validateSecurityPolicy(config);
    if (!securityResult.ok) return securityResult;

    const validResult = this.validator.validate(config, 'server-config');
    if (!validResult.ok) return validResult;

    const saveResult = await this.repo.save(config);
    if (!saveResult.ok) return saveResult;

    this.bus.emit('ServerUpdated', { serverId: config.id, workspaceFolderUri: this.workspaceFolderUri });
    for (const dep of config.deployments) {
      const prevDep = previous.deployments.find(d => d.id === dep.id);
      if (prevDep !== undefined && deploymentPersistedChanged(prevDep, dep)) {
        this.bus.emit('DeploymentUpdated', {
          serverId: config.id,
          deploymentId: dep.id,
          workspaceFolderUri: this.workspaceFolderUri,
        });
      }
    }
    this.logger.info(`ConfigService: updated server '${config.name}'`);
    return ok(undefined);
  }

  /** Remove a server and emit event. */
  async removeServer(serverId: ServerId): Promise<Result<void, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'modify server inventory');
    if (!trustResult.ok) return trustResult;

    if (!this.repo.get(serverId)) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Server '${serverId}' not found`,
      }));
    }

    const deleteResult = await this.repo.delete(serverId);
    if (!deleteResult.ok) return deleteResult;

    this.bus.emit('ServerDeleted', { serverId, workspaceFolderUri: this.workspaceFolderUri });
    this.logger.info(`ConfigService: removed server '${serverId}'`);
    return ok(undefined);
  }

  /** Add a deployment to a server. */
  async addDeployment(serverId: ServerId, dep: DeploymentConfig): Promise<Result<void, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'modify deployment configuration');
    if (!trustResult.ok) return trustResult;

    const server = this.repo.get(serverId);
    if (!server) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Server '${serverId}' not found`,
      }));
    }

    if (server.deployments.some(d => d.id === dep.id)) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Deployment '${dep.id}' already exists on server '${serverId}'`,
      }));
    }

    const updated: ServerConfig = {
      ...server,
      deployments: [...server.deployments, dep],
    };

    const securityResult = validateSecurityPolicy(updated);
    if (!securityResult.ok) return securityResult;

    const validResult = this.validator.validate(updated, 'server-config');
    if (!validResult.ok) return validResult;

    const saveResult = await this.repo.save(updated);
    if (!saveResult.ok) return saveResult;

    this.bus.emit('DeploymentAdded', { serverId, deploymentId: dep.id, workspaceFolderUri: this.workspaceFolderUri });
    return ok(undefined);
  }

  /** Remove a deployment from a server. */
  async removeDeployment(serverId: ServerId, deploymentId: DeploymentId): Promise<Result<void, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'modify deployment configuration');
    if (!trustResult.ok) return trustResult;

    const server = this.repo.get(serverId);
    if (!server) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Server '${serverId}' not found`,
      }));
    }

    const updated: ServerConfig = {
      ...server,
      deployments: server.deployments.filter(d => d.id !== deploymentId),
    };

    const saveResult = await this.repo.save(updated);
    if (!saveResult.ok) return saveResult;

    this.bus.emit('DeploymentRemoved', { serverId, deploymentId, workspaceFolderUri: this.workspaceFolderUri });
    return ok(undefined);
  }

  /** Check for external config file changes. */
  async checkForExternalChanges(): Promise<boolean> {
    return this.repo.isDirty();
  }

  /** Reload config from disk (after external change). */
  async reload(): Promise<Result<ServerConfig[], JsmError>> {
    const result = await this.repo.load();
    if (result.ok) {
      this.bus.emit('ConfigChanged', { source: 'external', workspaceFolderUri: this.workspaceFolderUri });
    }
    return result;
  }
}

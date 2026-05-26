import type {
  ServerConfig,
  DeploymentConfig,
  ServerId,
  DeploymentId,
  Logger,
} from '@core/types';
import * as path from 'path';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { EventBus } from '@core/events/EventBus';
import type { SchemaValidator } from '@core/validation/SchemaValidator';
import type { ConfigRepo } from '@infra/fs/ConfigRepo';
import { requireWorkspaceTrust, validateSecurityPolicy } from '@core/policy';
import type { TrustGate } from '@core/types/runtime';

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringRecord(
  left: Readonly<Record<string, string>> | undefined,
  right: Readonly<Record<string, string>> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value]) => right?.[key] === value);
}

function sameHookConfig(
  left: DeploymentConfig['hooks'][number],
  right: DeploymentConfig['hooks'][number],
): boolean {
  return left.id === right.id
    && left.enabled === right.enabled
    && left.phase === right.phase
    && left.event === right.event
    && left.kind === right.kind
    && left.timeoutMs === right.timeoutMs
    && left.continueOnError === right.continueOnError
    && left.command?.mode === right.command?.mode
    && left.command?.line === right.command?.line
    && left.command?.cwd === right.command?.cwd
    && sameStringRecord(left.command?.env, right.command?.env)
    && left.vscodeTask?.taskName === right.vscodeTask?.taskName;
}

function sameBuildConfig(
  left: DeploymentConfig['build'],
  right: DeploymentConfig['build'],
): boolean {
  if (!left || !right) return left === right;
  return left.enabled === right.enabled
    && left.kind === right.kind
    && left.trigger === right.trigger
    && left.timeoutMs === right.timeoutMs
    && left.command?.mode === right.command?.mode
    && left.command?.line === right.command?.line
    && left.command?.cwd === right.command?.cwd
    && sameStringRecord(left.command?.env, right.command?.env)
    && left.vscodeTask?.taskName === right.vscodeTask?.taskName;
}

function sameReadinessGateConfig(
  left: DeploymentConfig['readinessGate'],
  right: DeploymentConfig['readinessGate'],
): boolean {
  if (!left || !right) return left === right;
  return left.enabled === right.enabled
    && left.trigger === right.trigger;
}

function deploymentPersistedChanged(before: DeploymentConfig, after: DeploymentConfig): boolean {
  return before.id !== after.id
    || before.type !== after.type
    || before.sourcePath !== after.sourcePath
    || before.deployName !== after.deployName
    || before.syncMode !== after.syncMode
    || before.hotReload !== after.hotReload
    || !sameStringArray(before.ignoreGlobs, after.ignoreGlobs)
    || !sameBuildConfig(before.build, after.build)
    || !sameReadinessGateConfig(before.readinessGate, after.readinessGate)
    || before.healthCheckPath !== after.healthCheckPath
    || before.healthCheckTimeoutMs !== after.healthCheckTimeoutMs
    || before.hooks.length !== after.hooks.length
    || before.hooks.some((hook, index) => !sameHookConfig(hook, after.hooks[index]));
}

function comparablePath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function comparableDeploymentName(value: string): string {
  return value.toLowerCase();
}

function getTomcatShutdownPort(config: ServerConfig): number | undefined {
  const pluginConfig = config.pluginConfig as { type?: string; shutdownPort?: unknown } | undefined;
  if (config.type !== 'tomcat' || pluginConfig?.type !== 'tomcat') {
    return undefined;
  }

  return typeof pluginConfig.shutdownPort === 'number' ? pluginConfig.shutdownPort : 8005;
}

function getTomcatSslPort(config: ServerConfig): number | undefined {
  const pluginConfig = config.pluginConfig as {
    type?: string;
    ssl?: { enabled?: unknown; port?: unknown };
  } | undefined;
  if (config.type !== 'tomcat' || pluginConfig?.type !== 'tomcat' || pluginConfig.ssl?.enabled !== true) {
    return undefined;
  }

  return typeof pluginConfig.ssl.port === 'number' ? pluginConfig.ssl.port : undefined;
}

type PortUse = {
  serverId: ServerId;
  serverName: string;
  role: string;
};

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
    const loadResult = await this.repo.readWorkspace();
    if (!loadResult.ok) return loadResult;

    const validateResult = this.validateLoadedServers(loadResult.value.servers);
    if (!validateResult.ok) return validateResult;

    this.repo.replaceAll(loadResult.value.servers, loadResult.value.content);
    const servers = this.repo.getAll();
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

  private validateForPersistence(config: ServerConfig): Result<void, JsmError> {
    const securityResult = validateSecurityPolicy(config);
    if (!securityResult.ok) {
      return securityResult;
    }

    return this.validator.validate(config, 'server-config');
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

    const validResult = this.validateForPersistence(config);
    if (!validResult.ok) return validResult;

    const invariantResult = this.validateInventoryInvariants([...this.repo.getAll(), config]);
    if (!invariantResult.ok) return invariantResult;

    const saveResult = await this.repo.save(config);
    if (!saveResult.ok) return saveResult;

    this.bus.emit('ServerAdded', { serverId: config.id, workspaceFolderUri: this.workspaceFolderUri });
    this.logger.info(`ConfigService: added server '${config.name}'`);
    return ok(undefined);
  }

  /** Validate prospective servers against the current authoritative inventory without persisting. */
  validateServerCandidates(configs: readonly ServerConfig[]): Result<void, JsmError> {
    for (const config of configs) {
      const validResult = this.validateForPersistence(config);
      if (!validResult.ok) return validResult;
    }

    return this.validateInventoryInvariants([...this.repo.getAll(), ...configs]);
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

    const validResult = this.validateForPersistence(config);
    if (!validResult.ok) return validResult;

    const invariantResult = this.validateInventoryInvariants(
      this.repo.getAll().map(server => server.id === config.id ? config : server),
    );
    if (!invariantResult.ok) return invariantResult;

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

    const validResult = this.validateForPersistence(updated);
    if (!validResult.ok) return validResult;

    const invariantResult = this.validateInventoryInvariants(
      this.repo.getAll().map(candidate => candidate.id === serverId ? updated : candidate),
    );
    if (!invariantResult.ok) return invariantResult;

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

    if (!server.deployments.some(d => d.id === deploymentId)) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Deployment '${deploymentId}' not found on server '${serverId}'`,
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
    const loadResult = await this.repo.readWorkspace();
    if (!loadResult.ok) return loadResult;

    const validateResult = this.validateLoadedServers(loadResult.value.servers);
    if (!validateResult.ok) return validateResult;

    this.repo.replaceAll(loadResult.value.servers, loadResult.value.content);
    const servers = this.repo.getAll();
    this.bus.emit('ConfigChanged', { source: 'external', workspaceFolderUri: this.workspaceFolderUri });
    return ok(servers);
  }

  private validateLoadedServers(servers: readonly ServerConfig[]): Result<void, JsmError> {
    for (const server of servers) {
      const validationResult = this.validateForPersistence(server);
      if (!validationResult.ok) {
        return validationResult;
      }
    }

    const invariantResult = this.validateInventoryInvariants(servers);
    if (!invariantResult.ok) {
      return invariantResult;
    }

    return ok(undefined);
  }

  private validateInventoryInvariants(servers: readonly ServerConfig[]): Result<void, JsmError> {
    const instancePaths = new Map<string, ServerConfig>();
    const ports = new Map<number, PortUse>();

    for (const server of servers) {
      const instanceKey = comparablePath(server.instancePath);
      const existingInstance = instancePaths.get(instanceKey);
      if (existingInstance && existingInstance.id !== server.id) {
        return this.invalidInventory(
          `Instance path '${server.instancePath}' is already used by server '${existingInstance.name}' (${existingInstance.id}).`,
        );
      }
      instancePaths.set(instanceKey, server);

      const deploymentNames = new Map<string, DeploymentConfig>();
      for (const dep of server.deployments) {
        const deploymentKey = comparableDeploymentName(dep.deployName);
        const existingDeployment = deploymentNames.get(deploymentKey);
        if (existingDeployment) {
          return this.invalidInventory(
            `Deployment target '${dep.deployName}' is duplicated on server '${server.name}' (${server.id}).`,
          );
        }
        deploymentNames.set(deploymentKey, dep);
      }

      const portResult = this.recordPortUse(ports, server, 'HTTP', server.ports.http);
      if (!portResult.ok) return portResult;

      if (server.debug.enabled && server.ports.debug !== undefined) {
        const debugResult = this.recordPortUse(ports, server, 'debug', server.ports.debug);
        if (!debugResult.ok) return debugResult;
      }

      const shutdownPort = getTomcatShutdownPort(server);
      if (shutdownPort !== undefined) {
        const shutdownResult = this.recordPortUse(ports, server, 'shutdown', shutdownPort);
        if (!shutdownResult.ok) return shutdownResult;
      }

      const sslPort = getTomcatSslPort(server);
      if (sslPort !== undefined) {
        const sslResult = this.recordPortUse(ports, server, 'SSL', sslPort);
        if (!sslResult.ok) return sslResult;
      }
    }

    return ok(undefined);
  }

  private recordPortUse(
    ports: Map<number, PortUse>,
    server: ServerConfig,
    role: string,
    port: number,
  ): Result<void, JsmError> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return ok(undefined);
    }

    const existing = ports.get(port);
    if (existing) {
      return this.invalidInventory(
        `Port ${port} (${role}) on server '${server.name}' (${server.id}) conflicts with `
        + `${existing.role} on server '${existing.serverName}' (${existing.serverId}).`,
      );
    }

    ports.set(port, {
      serverId: server.id,
      serverName: server.name,
      role,
    });
    return ok(undefined);
  }

  private invalidInventory(message: string): Result<void, JsmError> {
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message,
    }));
  }
}

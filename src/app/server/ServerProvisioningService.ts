import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import type { CreateServerRequest } from '@core/authoring';
import type { Result } from '@core/result';
import { err, ok } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { Logger, ServerConfig, TrustGate } from '@core/types';
import type { ConfigService } from '@app/config/ConfigService';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import { ManagedInstancePathResolver } from './ManagedInstancePathResolver';
import { requireWorkspaceTrust } from '@core/policy';

const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_DEBUG_PORT = 5005;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_DEBUG_BIND = '127.0.0.1';
const MANAGED_INSTANCE_MARKER = '.jsm-managed-instance';

export class ServerProvisioningService {
  private readonly configService: ConfigService;
  private readonly pluginRegistry: PluginRegistry;
  private readonly pathResolver: ManagedInstancePathResolver;
  private readonly logger: Logger;
  private readonly trustGate?: TrustGate;

  constructor(deps: {
    configService: ConfigService;
    pluginRegistry: PluginRegistry;
    pathResolver: ManagedInstancePathResolver;
    logger: Logger;
    trustGate?: TrustGate;
  }) {
    this.configService = deps.configService;
    this.pluginRegistry = deps.pluginRegistry;
    this.pathResolver = deps.pathResolver;
    this.logger = deps.logger;
    this.trustGate = deps.trustGate;
  }

  async createServer(request: CreateServerRequest): Promise<Result<ServerConfig, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'provision managed servers');
    if (!trustResult.ok) return trustResult;

    const type = request.type ?? 'tomcat';
    const plugin = this.pluginRegistry.get(type);
    if (!plugin) {
      return err(new JsmError({
        code: ErrorCode.Unsupported,
        message: `No plugin registered for server type '${type}'`,
      }));
    }

    const detectResult = await plugin.detectInstallation(request.runtimeHomePath);
    if (!detectResult.ok) {
      return detectResult;
    }
    if (!detectResult.value.ok) {
      return err(new JsmError({
        code: ErrorCode.ValidationFailed,
        message: 'Tomcat installation validation failed',
        details: detectResult.value.checks
          .filter(check => !check.ok)
          .map(check => check.message)
          .join('; '),
        suggestedFix: detectResult.value.checks
          .filter(check => !check.ok)
          .map(check => check.message),
      }));
    }

    const serverId = uuid();
    const instancePath = this.pathResolver.resolve(serverId);
    const defaults = plugin.getDefaultConfig();

    const serverConfig = this.buildServerConfig({
      serverId,
      instancePath,
      request,
      detectedVersion: detectResult.value.version,
      defaults,
    });

    const validateResult = await plugin.validateConfig(serverConfig);
    if (!validateResult.ok) {
      return validateResult;
    }

    if (!plugin.initializeInstancePath) {
      return err(new JsmError({
        code: ErrorCode.Unsupported,
        message: `Plugin '${type}' does not support managed instance provisioning`,
      }));
    }

    const markerResult = await this.writeManagedInstanceMarker(serverConfig.instancePath, serverConfig.id);
    if (!markerResult.ok) {
      return markerResult;
    }

    const initResult = await plugin.initializeInstancePath(
      serverConfig.runtime.homePath,
      serverConfig.instancePath,
      serverConfig,
    );
    if (!initResult.ok) {
      await this.cleanupManagedInstance(serverConfig.instancePath);
      return initResult;
    }

    const saveResult = await this.configService.addServer(serverConfig);
    if (!saveResult.ok) {
      await this.cleanupManagedInstance(serverConfig.instancePath);
      return err(saveResult.error);
    }

    this.logger.info(`ServerProvisioningService: provisioned managed server '${serverConfig.name}'`);
    return ok(serverConfig);
  }

  /**
   * Duplicate a server: clone config with new id, new instancePath (own instance), init dir, save.
   * After duplicate, the two servers are independent (fork).
   * @param options.keepName - if true, keep the source name (used for import from file); default false adds " (Copy)".
   */
  async duplicateServer(
    source: ServerConfig,
    options?: { keepName?: boolean },
  ): Promise<Result<ServerConfig, JsmError>> {
    const planResult = await this.planDuplicateServer(source, options);
    if (!planResult.ok) return planResult;

    return this.provisionPlannedDuplicate(source, planResult.value);
  }

  /**
   * Build and validate the cloned config for a duplicate/import without writing files or inventory.
   */
  async planDuplicateServer(
    source: ServerConfig,
    options?: { keepName?: boolean },
  ): Promise<Result<ServerConfig, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'provision managed servers');
    if (!trustResult.ok) return trustResult;

    const keepName = options?.keepName ?? false;
    const plugin = this.pluginRegistry.get(source.type);
    if (!plugin) {
      return err(new JsmError({
        code: ErrorCode.Unsupported,
        message: `No plugin registered for server type '${source.type}'`,
      }));
    }
    if (!plugin.initializeInstancePath) {
      return err(new JsmError({
        code: ErrorCode.Unsupported,
        message: `Plugin '${source.type}' does not support managed instance provisioning`,
      }));
    }

    const cloned = this.buildDuplicateServerConfig(source, keepName);

    const validateResult = await plugin.validateConfig(cloned);
    if (!validateResult.ok) {
      return validateResult;
    }

    return ok(cloned);
  }

  /** Apply a previously validated duplicate/import plan. */
  async provisionPlannedDuplicate(
    source: ServerConfig,
    planned: ServerConfig,
  ): Promise<Result<ServerConfig, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'provision managed servers');
    if (!trustResult.ok) return trustResult;

    const plugin = this.pluginRegistry.get(source.type);
    if (!plugin) {
      return err(new JsmError({
        code: ErrorCode.Unsupported,
        message: `No plugin registered for server type '${source.type}'`,
      }));
    }
    if (!plugin.initializeInstancePath) {
      return err(new JsmError({
        code: ErrorCode.Unsupported,
        message: `Plugin '${source.type}' does not support managed instance provisioning`,
      }));
    }

    const validateResult = await plugin.validateConfig(planned);
    if (!validateResult.ok) {
      return validateResult;
    }

    const markerResult = await this.writeManagedInstanceMarker(planned.instancePath, planned.id);
    if (!markerResult.ok) {
      return markerResult;
    }

    const initResult = await plugin.initializeInstancePath(
      source.runtime.homePath,
      planned.instancePath,
      planned,
    );
    if (!initResult.ok) {
      await this.cleanupManagedInstance(planned.instancePath);
      return initResult;
    }

    const saveResult = await this.configService.addServer(planned);
    if (!saveResult.ok) {
      await this.cleanupManagedInstance(planned.instancePath);
      return err(saveResult.error);
    }

    this.logger.info(`ServerProvisioningService: duplicated server '${source.name}' as '${planned.name}'`);
    return ok(planned);
  }

  async removeServer(serverId: string): Promise<Result<void, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'remove managed servers');
    if (!trustResult.ok) return trustResult;

    const existing = this.configService.getServer(serverId);
    if (!existing) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Server '${serverId}' not found`,
      }));
    }

    const cleanupResult = await this.cleanupManagedInstance(existing.instancePath);
    if (!cleanupResult.ok) {
      return cleanupResult;
    }

    const removeResult = await this.configService.removeServer(serverId);
    if (!removeResult.ok) {
      return removeResult;
    }

    this.logger.info(`ServerProvisioningService: removed managed server '${serverId}'`);
    return ok(undefined);
  }

  private buildServerConfig(args: {
    serverId: string;
    instancePath: string;
    request: CreateServerRequest;
    detectedVersion?: string;
    defaults: Partial<ServerConfig>;
  }): ServerConfig {
    const { serverId, instancePath, request, detectedVersion, defaults } = args;

    return {
      id: serverId,
      name: request.name.trim(),
      type: request.type ?? 'tomcat',
      runtime: {
        id: uuid(),
        homePath: request.runtimeHomePath,
        version: detectedVersion,
      },
      instancePath,
      javaHome: request.javaHome,
      host: request.host ?? defaults.host ?? DEFAULT_HOST,
      ports: {
        http: request.httpPort ?? defaults.ports?.http ?? DEFAULT_HTTP_PORT,
        debug: request.debugPort ?? defaults.ports?.debug ?? DEFAULT_DEBUG_PORT,
      },
      run: {
        env: defaults.run?.env ?? {},
        envProfileId: request.envProfileId,
        vmArgs: request.vmArgs ?? defaults.run?.vmArgs ?? [],
        cwd: defaults.run?.cwd,
      },
      debug: {
        enabled: defaults.debug?.enabled ?? true,
        bind: request.debugBind ?? defaults.debug?.bind ?? DEFAULT_DEBUG_BIND,
        attachDelayMs: defaults.debug?.attachDelayMs ?? 1000,
      },
      deployments: [],
      autosync: {
        enabled: defaults.autosync?.enabled ?? true,
        debounceMs: defaults.autosync?.debounceMs ?? 400,
        maxBatchFiles: defaults.autosync?.maxBatchFiles ?? 200,
        maxBatchBytes: defaults.autosync?.maxBatchBytes ?? 20_000_000,
        stormBackoffMs: defaults.autosync?.stormBackoffMs ?? 2000,
        ignoreGlobs: defaults.autosync?.ignoreGlobs ?? ['**/.git/**', '**/node_modules/**'],
      },
      hooks: request.hooks ?? [],
      pluginConfig: request.pluginConfig ?? defaults.pluginConfig,
    };
  }

  private buildDuplicateServerConfig(source: ServerConfig, keepName: boolean): ServerConfig {
    const newId = uuid();
    return {
      ...source,
      id: newId,
      name: keepName ? source.name : `${source.name} (Copy)`,
      runtime: {
        ...source.runtime,
        id: uuid(),
      },
      instancePath: this.pathResolver.resolve(newId),
      deployments: source.deployments.map(d => ({ ...d, id: uuid() })),
      hooks: source.hooks.map(h => ({ ...h })),
      autosync: { ...source.autosync },
      pluginConfig: source.pluginConfig ? { ...source.pluginConfig } : undefined,
    };
  }

  private async cleanupManagedInstance(instancePath: string): Promise<Result<void, JsmError>> {
    try {
      const safetyResult = await this.validateManagedInstancePath(instancePath);
      if (!safetyResult.ok) {
        return safetyResult;
      }

      await fs.rm(instancePath, { recursive: true, force: true });
      return ok(undefined);
    } catch (cause) {
      const error = new JsmError({
        code: ErrorCode.Unknown,
        message: 'Server config was removed, but managed instance cleanup failed.',
        details: cause instanceof Error ? cause.message : String(cause),
        suggestedFix: ['Use diagnostics to inspect the instance path', 'Remove the leftover managed directory manually if needed'],
        cause,
      });
      this.logger.warn(`ServerProvisioningService: failed to clean up managed instance '${instancePath}': ${String(cause)}`);
      return err(error);
    }
  }

  private async writeManagedInstanceMarker(instancePath: string, serverId: string): Promise<Result<void, JsmError>> {
    try {
      await fs.mkdir(instancePath, { recursive: true });
      await fs.writeFile(path.join(instancePath, MANAGED_INSTANCE_MARKER), `${serverId}\n`, 'utf8');
      return ok(undefined);
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.ConfigWriteFailed,
        message: `Failed to mark managed instance path: ${instancePath}`,
        details: cause instanceof Error ? cause.message : String(cause),
        cause,
      }));
    }
  }

  private async validateManagedInstancePath(instancePath: string): Promise<Result<void, JsmError>> {
    const storageRoot = this.pathResolver.getStorageRoot();

    let realRoot: string;
    let realInstancePath: string;
    try {
      realRoot = await fs.realpath(storageRoot);
      realInstancePath = await fs.realpath(instancePath);
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: 'Managed instance path does not exist or cannot be verified.',
        details: cause instanceof Error ? cause.message : String(cause),
        suggestedFix: ['Check the configured instance path before removing this server'],
        cause,
      }));
    }

    const relative = path.relative(realRoot, realInstancePath);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Refusing to delete '${instancePath}' because it is not a managed JSM instance path.`,
        details: `Managed storage root: ${storageRoot}`,
        suggestedFix: ['Remove or move the server configuration from the dashboard without deleting external files'],
      }));
    }

    try {
      const marker = await fs.readFile(path.join(realInstancePath, MANAGED_INSTANCE_MARKER), 'utf8');
      if (marker.trim().length === 0) {
        throw new Error('Managed marker is empty.');
      }
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Refusing to delete '${instancePath}' because the managed marker is missing.`,
        details: cause instanceof Error ? cause.message : String(cause),
        suggestedFix: [`Expected marker file: ${path.join(instancePath, MANAGED_INSTANCE_MARKER)}`],
        cause,
      }));
    }

    return ok(undefined);
  }
}

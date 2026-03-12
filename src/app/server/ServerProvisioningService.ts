import * as fs from 'fs/promises';
import { v4 as uuid } from 'uuid';
import type { Result } from '@core/result';
import { err, ok } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { HookConfig, Logger, PluginConfig, ServerConfig } from '@core/types';
import type { ConfigService } from '@app/config/ConfigService';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import { ManagedInstancePathResolver } from './ManagedInstancePathResolver';

const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_DEBUG_PORT = 5005;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_DEBUG_BIND = '127.0.0.1';

export interface CreateServerRequest {
  name: string;
  type?: 'tomcat';
  runtimeHomePath: string;
  javaHome: string;
  host?: string;
  httpPort?: number;
  debugPort?: number;
  debugBind?: string;
  vmArgs?: string[];
  hooks?: HookConfig[];
  pluginConfig?: PluginConfig;
}

export class ServerProvisioningService {
  private readonly configService: ConfigService;
  private readonly pluginRegistry: PluginRegistry;
  private readonly pathResolver: ManagedInstancePathResolver;
  private readonly logger: Logger;

  constructor(deps: {
    configService: ConfigService;
    pluginRegistry: PluginRegistry;
    pathResolver: ManagedInstancePathResolver;
    logger: Logger;
  }) {
    this.configService = deps.configService;
    this.pluginRegistry = deps.pluginRegistry;
    this.pathResolver = deps.pathResolver;
    this.logger = deps.logger;
  }

  async createServer(request: CreateServerRequest): Promise<Result<ServerConfig, JsmError>> {
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

    const initResult = await plugin.initializeInstancePath(
      serverConfig.runtime.homePath,
      serverConfig.instancePath,
      serverConfig,
    );
    if (!initResult.ok) {
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
   */
  async duplicateServer(source: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
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

    const newId = uuid();
    const instancePath = this.pathResolver.resolve(newId);
    const cloned: ServerConfig = {
      ...source,
      id: newId,
      name: `${source.name} (Copy)`,
      runtime: {
        ...source.runtime,
        id: uuid(),
      },
      instancePath,
      deployments: source.deployments.map(d => ({ ...d, id: uuid() })),
      hooks: source.hooks.map(h => ({ ...h })),
      autosync: { ...source.autosync },
      pluginConfig: source.pluginConfig ? { ...source.pluginConfig } : undefined,
    };

    const validateResult = await plugin.validateConfig(cloned);
    if (!validateResult.ok) {
      return validateResult;
    }

    const initResult = await plugin.initializeInstancePath(
      source.runtime.homePath,
      cloned.instancePath,
      cloned,
    );
    if (!initResult.ok) {
      return initResult;
    }

    const saveResult = await this.configService.addServer(cloned);
    if (!saveResult.ok) {
      await this.cleanupManagedInstance(cloned.instancePath);
      return err(saveResult.error);
    }

    this.logger.info(`ServerProvisioningService: duplicated server '${source.name}' as '${cloned.name}'`);
    return ok(cloned);
  }

  async removeServer(serverId: string): Promise<Result<void, JsmError>> {
    const existing = this.configService.getServer(serverId);
    if (!existing) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Server '${serverId}' not found`,
      }));
    }

    const removeResult = await this.configService.removeServer(serverId);
    if (!removeResult.ok) {
      return removeResult;
    }

    const cleanupResult = await this.cleanupManagedInstance(existing.instancePath);
    if (!cleanupResult.ok) {
      return cleanupResult;
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

  private async cleanupManagedInstance(instancePath: string): Promise<Result<void, JsmError>> {
    try {
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
}

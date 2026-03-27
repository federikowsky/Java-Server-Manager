import type { DeploymentConfig, ServerConfig, ServerId, DeploymentId, Logger } from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { ConfigService } from './ConfigService';
import type { ServerProvisioningService } from '@app/server/ServerProvisioningService';

export interface WorkspaceScope {
  uri: string;
  name: string;
  fsPath: string;
}

export interface WorkspaceServerLocator {
  workspaceFolderUri: string;
  serverId: ServerId;
}

export interface WorkspaceServerRecord extends WorkspaceServerLocator {
  workspaceFolderName: string;
  workspaceFolderFsPath: string;
  serverKey: ServerId;
  config: ServerConfig;
}

export interface WorkspaceServiceEntry {
  scope: WorkspaceScope;
  configService: ConfigService;
  provisioningService: ServerProvisioningService;
  configFilePath: string;
}

export function makeWorkspaceServerKey(
  workspaceFolderUri: string | undefined,
  serverId: ServerId,
): ServerId {
  if (!workspaceFolderUri) return serverId;
  return `${workspaceFolderUri}::${serverId}`;
}

function parseWorkspaceServerKey(serverKey: ServerId): WorkspaceServerLocator | undefined {
  const separator = serverKey.lastIndexOf('::');
  if (separator <= 0) {
    // If no workspace prefix is supplied, treat the key as a bare serverId.
    return { workspaceFolderUri: '', serverId: serverKey };
  }

  return {
    workspaceFolderUri: serverKey.slice(0, separator),
    serverId: serverKey.slice(separator + 2),
  };
}

export class WorkspaceServiceRegistry {
  private readonly entriesByUri = new Map<string, WorkspaceServiceEntry>();
  private readonly logger: Logger;

  constructor(entries: WorkspaceServiceEntry[], logger: Logger) {
    this.logger = logger;
    for (const entry of entries) {
      this.entriesByUri.set(entry.scope.uri, entry);
    }
  }

  /** Add or replace the entry for {@link WorkspaceServiceEntry.scope.uri}. */
  registerEntry(entry: WorkspaceServiceEntry): void {
    this.entriesByUri.set(entry.scope.uri, entry);
  }

  /** Remove a workspace folder; returns whether an entry existed. */
  removeEntry(workspaceFolderUri: string): boolean {
    return this.entriesByUri.delete(workspaceFolderUri);
  }

  getWorkspaceScopes(): WorkspaceScope[] {
    return [...this.entriesByUri.values()].map(entry => entry.scope);
  }

  getEntry(workspaceFolderUri: string): WorkspaceServiceEntry | undefined {
    return this.entriesByUri.get(workspaceFolderUri);
  }

  getConfigFilePath(workspaceFolderUri: string): string | undefined {
    return this.entriesByUri.get(workspaceFolderUri)?.configFilePath;
  }

  getServer(locator: WorkspaceServerLocator): ServerConfig | undefined {
    return this.entriesByUri.get(locator.workspaceFolderUri)?.configService.getServer(locator.serverId);
  }

  getServerRecordByKey(serverKey: ServerId): WorkspaceServerRecord | undefined {
    const locator = parseWorkspaceServerKey(serverKey);
    if (!locator) {
      return undefined;
    }

    const entry = this.entriesByUri.get(locator.workspaceFolderUri);
    const config = entry?.configService.getServer(locator.serverId);
    if (!entry || !config) {
      return undefined;
    }

    return this.toRecord(entry, config);
  }

  getAllServers(): WorkspaceServerRecord[] {
    return [...this.entriesByUri.values()].flatMap(entry =>
      entry.configService.getAllServers().map(config => this.toRecord(entry, config)),
    );
  }

  getServers(workspaceFolderUri: string): WorkspaceServerRecord[] {
    const entry = this.entriesByUri.get(workspaceFolderUri);
    if (!entry) {
      return [];
    }

    return entry.configService.getAllServers().map(config => this.toRecord(entry, config));
  }

  async updateServer(
    locator: WorkspaceServerLocator,
    config: ServerConfig,
  ): Promise<Result<void, JsmError>> {
    const entry = this.entriesByUri.get(locator.workspaceFolderUri);
    if (!entry) {
      return this.workspaceNotFound(locator.workspaceFolderUri);
    }

    return entry.configService.updateServer(config);
  }

  async addServer(
    workspaceFolderUri: string,
    config: ServerConfig,
  ): Promise<Result<void, JsmError>> {
    const entry = this.entriesByUri.get(workspaceFolderUri);
    if (!entry) {
      return this.workspaceNotFound(workspaceFolderUri);
    }

    return entry.configService.addServer(config);
  }

  async removeServer(
    locator: WorkspaceServerLocator,
  ): Promise<Result<void, JsmError>> {
    const entry = this.entriesByUri.get(locator.workspaceFolderUri);
    if (!entry) {
      return this.workspaceNotFound(locator.workspaceFolderUri);
    }

    return entry.configService.removeServer(locator.serverId);
  }

  async addDeployment(
    locator: WorkspaceServerLocator,
    deployment: DeploymentConfig,
  ): Promise<Result<void, JsmError>> {
    const entry = this.entriesByUri.get(locator.workspaceFolderUri);
    if (!entry) {
      return this.workspaceNotFound(locator.workspaceFolderUri);
    }

    return entry.configService.addDeployment(locator.serverId, deployment);
  }

  async removeDeployment(
    locator: WorkspaceServerLocator,
    deploymentId: DeploymentId,
  ): Promise<Result<void, JsmError>> {
    const entry = this.entriesByUri.get(locator.workspaceFolderUri);
    if (!entry) {
      return this.workspaceNotFound(locator.workspaceFolderUri);
    }

    return entry.configService.removeDeployment(locator.serverId, deploymentId);
  }

  async reloadAll(): Promise<Result<void, JsmError>> {
    for (const entry of this.entriesByUri.values()) {
      const result = await entry.configService.reload();
      if (!result.ok) {
        return err(new JsmError({
          code: result.error.code,
          message: `Failed to reload workspace '${entry.scope.name}'`,
          details: result.error.message,
          cause: result.error,
        }));
      }
    }

    return ok(undefined);
  }

  private toRecord(
    entry: WorkspaceServiceEntry,
    config: ServerConfig,
  ): WorkspaceServerRecord {
    return {
      workspaceFolderUri: entry.scope.uri,
      workspaceFolderName: entry.scope.name,
      workspaceFolderFsPath: entry.scope.fsPath,
      serverId: config.id,
      serverKey: makeWorkspaceServerKey(entry.scope.uri, config.id),
      config,
    };
  }

  private workspaceNotFound(workspaceFolderUri: string): Result<never, JsmError> {
    this.logger.warn(`WorkspaceServiceRegistry: workspace '${workspaceFolderUri}' not found`);
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: `Workspace '${workspaceFolderUri}' is not registered`,
    }));
  }
}
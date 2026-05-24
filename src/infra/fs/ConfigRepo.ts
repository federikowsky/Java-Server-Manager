import * as path from 'path';
import type { ServerConfig } from '@core/types';
import type { Logger } from '@core/types/logger';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { WORKSPACE_CONFIG_FILENAME, WORKSPACE_CONFIG_DIR } from '../../constants';
import { atomicWrite, readFileSafe, exists } from './FileUtils';

export const CURRENT_WORKSPACE_CONFIG_VERSION = 1;
const LEGACY_WORKSPACE_CONFIG_VERSION = 0;

interface WorkspaceConfig {
  version?: unknown;
  servers?: ServerConfig[];
}

export interface ParsedWorkspaceConfig {
  content: string;
  version: typeof CURRENT_WORKSPACE_CONFIG_VERSION;
  migratedFromVersion?: typeof LEGACY_WORKSPACE_CONFIG_VERSION;
  servers: ServerConfig[];
}

/**
 * Config file repository for `.vscode/jsm.servers.json`.
 * - In-memory Map cache
 * - Serialized write queue (§5.5)
 * - External change detection delegated to caller via `isDirty()`
 */
export class ConfigRepo {
  private readonly configPath: string;
  private readonly logger: Logger;
  private cache: Map<string, ServerConfig> = new Map();
  private writeQueue: Promise<void> = Promise.resolve();
  private lastKnownContent = '';

  constructor(workspaceFolder: string, logger: Logger) {
    this.configPath = path.join(workspaceFolder, WORKSPACE_CONFIG_DIR, WORKSPACE_CONFIG_FILENAME);
    this.logger = logger;
  }

  get filePath(): string {
    return this.configPath;
  }

  /** Read and parse workspace config without mutating the live cache. */
  async readWorkspace(): Promise<Result<ParsedWorkspaceConfig, JsmError>> {
    const fileExists = await exists(this.configPath);
    if (!fileExists) {
      return ok({ content: '', version: CURRENT_WORKSPACE_CONFIG_VERSION, servers: [] });
    }

    const readResult = await readFileSafe(this.configPath);
    if (!readResult.ok) return readResult;

    try {
      const parsed = JSON.parse(readResult.value) as WorkspaceConfig;
      const versionResult = parseWorkspaceConfigVersion(parsed.version);
      if (!versionResult.ok) return versionResult;

      const servers = parsed.servers ?? [];
      if (!Array.isArray(servers)) {
        return err(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Workspace config must contain a "servers" array',
        }));
      }

      const seen = new Set<string>();

      for (const server of servers) {
        if (seen.has(server.id)) {
          return err(new JsmError({
            code: ErrorCode.InvalidConfig,
            message: `Duplicate server id '${server.id}' in workspace config`,
          }));
        }
        seen.add(server.id);
      }

      return ok({
        content: readResult.value,
        version: CURRENT_WORKSPACE_CONFIG_VERSION,
        migratedFromVersion: versionResult.value.migratedFromVersion,
        servers,
      });
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.ConfigReadFailed,
        message: 'Failed to parse config file',
        details: cause instanceof Error ? cause.message : String(cause),
        cause,
      }));
    }
  }

  /** Replace the in-memory cache from an already-validated workspace snapshot. */
  replaceAll(servers: readonly ServerConfig[], content: string): void {
    this.cache.clear();
    for (const server of servers) {
      this.cache.set(server.id, server);
    }
    this.lastKnownContent = content;
    this.logger.debug(`ConfigRepo: loaded ${this.cache.size} servers`);
  }

  /** Load config from disk. Returns all servers. */
  async load(): Promise<Result<ServerConfig[], JsmError>> {
    const parsedResult = await this.readWorkspace();
    if (!parsedResult.ok) return parsedResult;

    this.replaceAll(parsedResult.value.servers, parsedResult.value.content);
    return ok(this.getAll());
  }

  /** Get a server config by ID from cache. Call `load()` first. */
  get(serverId: string): ServerConfig | undefined {
    return this.cache.get(serverId);
  }

  /** Get all cached server configs. */
  getAll(): ServerConfig[] {
    return [...this.cache.values()];
  }

  /** Update a server config in cache and persist. */
  async save(config: ServerConfig): Promise<Result<void, JsmError>> {
    return this.flush((nextCache) => {
      nextCache.set(config.id, config);
    });
  }

  /** Remove a server and persist. */
  async delete(serverId: string): Promise<Result<void, JsmError>> {
    return this.flush((nextCache) => {
      nextCache.delete(serverId);
    });
  }

  /**
   * Check if the file was modified externally by comparing content.
   * Returns true if the file changed since last load/save.
   */
  async isDirty(): Promise<boolean> {
    const fileExists = await exists(this.configPath);
    if (!fileExists) {
      return this.lastKnownContent !== '';
    }

    const readResult = await readFileSafe(this.configPath);
    if (!readResult.ok) return true;
    return readResult.value !== this.lastKnownContent;
  }

  /** Serialize writes through a queue to prevent concurrent file races. */
  private flush(
    mutate: (nextCache: Map<string, ServerConfig>) => void,
  ): Promise<Result<void, JsmError>> {
    const write = async (): Promise<Result<void, JsmError>> => {
      const nextCache = new Map(this.cache);
      mutate(nextCache);

      const data: WorkspaceConfig = {
        version: CURRENT_WORKSPACE_CONFIG_VERSION,
        servers: [...nextCache.values()],
      };
      const content = JSON.stringify(data, null, 2);
      const result = await atomicWrite(this.configPath, content);
      if (result.ok) {
        this.cache = nextCache;
        this.lastKnownContent = content;
        this.logger.debug(`ConfigRepo: saved ${this.cache.size} servers`);
      }
      return result;
    };

    const pendingWrite = this.writeQueue.then(write, write);
    this.writeQueue = pendingWrite.then(() => undefined, () => undefined);
    return pendingWrite;
  }
}

function parseWorkspaceConfigVersion(
  value: unknown,
): Result<{
  version: typeof CURRENT_WORKSPACE_CONFIG_VERSION;
  migratedFromVersion?: typeof LEGACY_WORKSPACE_CONFIG_VERSION;
}, JsmError> {
  if (value === undefined || value === LEGACY_WORKSPACE_CONFIG_VERSION) {
    return ok({
      version: CURRENT_WORKSPACE_CONFIG_VERSION,
      migratedFromVersion: LEGACY_WORKSPACE_CONFIG_VERSION,
    });
  }

  if (!Number.isInteger(value)) {
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: `Workspace config version must be an integer; received ${JSON.stringify(value)}`,
    }));
  }

  if (value === CURRENT_WORKSPACE_CONFIG_VERSION) {
    return ok({ version: CURRENT_WORKSPACE_CONFIG_VERSION });
  }

  if (typeof value === 'number' && value > CURRENT_WORKSPACE_CONFIG_VERSION) {
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: `Workspace config version ${value} is newer than this extension supports`,
      suggestedFix: ['Update Java Server Manager before opening this workspace inventory'],
    }));
  }

  return err(new JsmError({
    code: ErrorCode.InvalidConfig,
    message: `Workspace config version ${value} is not supported`,
    suggestedFix: ['Export the inventory with a supported Java Server Manager version and import it again'],
  }));
}

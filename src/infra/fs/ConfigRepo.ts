import * as path from 'path';
import type { ServerConfig } from '@core/types';
import type { Logger } from '@core/types/logger';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { WORKSPACE_CONFIG_FILENAME, WORKSPACE_CONFIG_DIR } from '../../constants';
import { atomicWrite, readFileSafe, exists } from './FileUtils';

interface WorkspaceConfig {
  servers: ServerConfig[];
}

export interface ParsedWorkspaceConfig {
  content: string;
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
      return ok({ content: '', servers: [] });
    }

    const readResult = await readFileSafe(this.configPath);
    if (!readResult.ok) return readResult;

    try {
      const parsed: WorkspaceConfig = JSON.parse(readResult.value);
      const servers = parsed.servers ?? [];
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
    this.cache.set(config.id, config);
    return this.flush();
  }

  /** Remove a server and persist. */
  async delete(serverId: string): Promise<Result<void, JsmError>> {
    this.cache.delete(serverId);
    return this.flush();
  }

  /**
   * Check if the file was modified externally by comparing content.
   * Returns true if the file changed since last load/save.
   */
  async isDirty(): Promise<boolean> {
    const readResult = await readFileSafe(this.configPath);
    if (!readResult.ok) return false;
    return readResult.value !== this.lastKnownContent;
  }

  /** Serialize writes through a queue to prevent concurrent file races. */
  private flush(): Promise<Result<void, JsmError>> {
    return new Promise<Result<void, JsmError>>((resolve) => {
      this.writeQueue = this.writeQueue.then(async () => {
        const data: WorkspaceConfig = {
          servers: [...this.cache.values()],
        };
        const content = JSON.stringify(data, null, 2);
        const result = await atomicWrite(this.configPath, content);
        if (result.ok) {
          this.lastKnownContent = content;
          this.logger.debug(`ConfigRepo: saved ${this.cache.size} servers`);
        }
        resolve(result);
      });
    });
  }
}

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { ServerId } from '@core/types';
import type { Logger } from '@core/types/logger';
import { ensureDir } from '../fs/FileUtils';

/**
 * PID file operations (§5.5, §9.9).
 * - One PID file per server under the instance directory.
 * - Used by reconciliation to detect stale processes.
 */
export class PidManager {
  private readonly baseDir: string;
  private readonly logger: Logger;

  /**
   * @param baseDir  Root directory for PID files (e.g. `<workspaceFolder>/.jsm/pids/`).
   */
  constructor(baseDir: string, logger: Logger) {
    this.baseDir = baseDir;
    this.logger = logger;
  }

  /** Write a PID file for a server. */
  async writePid(serverId: ServerId, pid: number): Promise<void> {
    await ensureDir(this.baseDir);
    const filePath = this.pidPath(serverId);
    await fs.writeFile(filePath, String(pid), 'utf-8');
    this.logger.debug(`PidManager: wrote PID ${pid} for ${serverId}`);
  }

  /** Read the PID for a server. Returns undefined if no PID file. */
  async readPid(serverId: ServerId): Promise<number | undefined> {
    try {
      const content = await fs.readFile(this.pidPath(serverId), 'utf-8');
      const pid = parseInt(content.trim(), 10);
      return Number.isFinite(pid) ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  /** Remove the PID file for a server. */
  async clearPid(serverId: ServerId): Promise<void> {
    try {
      await fs.unlink(this.pidPath(serverId));
      this.logger.debug(`PidManager: cleared PID for ${serverId}`);
    } catch {
      // Already gone — fine
    }
  }

  /** Check if a process with the given PID is alive (signal 0 probe). */
  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private pidPath(serverId: ServerId): string {
    const normalizedServerId = String(serverId);
    const digest = createHash('sha1').update(normalizedServerId).digest('hex').slice(0, 12);
    const safeSegment = normalizedServerId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
    return path.join(this.baseDir, `${safeSegment}.${digest}.pid`);
  }
}

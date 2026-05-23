import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as os from 'os';
import type { ServerId } from '@core/types';
import type { Logger } from '@core/types/logger';
import { ensureDir } from '../fs/FileUtils';

export interface PidOwnershipMetadata {
  instancePath: string;
  runtimeHomePath: string;
}

export interface PidRecord extends PidOwnershipMetadata {
  pid: number;
  serverKey: string;
  writtenAt: number;
  processStartToken?: string;
  processCommand?: string;
}

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
  async writePid(serverId: ServerId, pid: number, metadata?: PidOwnershipMetadata): Promise<void> {
    await ensureDir(this.baseDir);
    const filePath = this.pidPath(serverId);
    const content = metadata
      ? `${JSON.stringify({
        pid,
        serverKey: String(serverId),
        instancePath: metadata.instancePath,
        runtimeHomePath: metadata.runtimeHomePath,
        writtenAt: Date.now(),
        processStartToken: this.readProcessStartToken(pid),
        processCommand: this.readProcessCommand(pid),
      } satisfies PidRecord, null, 2)}\n`
      : String(pid);
    await fs.writeFile(filePath, content, 'utf-8');
    this.logger.debug(`PidManager: wrote PID ${pid} for ${serverId}`);
  }

  /** Read the PID for a server. Returns undefined if no PID file. */
  async readPid(serverId: ServerId): Promise<number | undefined> {
    try {
      const content = await fs.readFile(this.pidPath(serverId), 'utf-8');
      const record = this.parsePidRecord(content);
      const pid = record?.pid ?? parseInt(content.trim(), 10);
      return Number.isFinite(pid) ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  /** Read the full PID ownership record. Legacy numeric PID files return undefined. */
  async readPidRecord(serverId: ServerId): Promise<PidRecord | undefined> {
    try {
      const content = await fs.readFile(this.pidPath(serverId), 'utf-8');
      return this.parsePidRecord(content);
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

  /** Check PID liveness and process-start identity to avoid trusting PID reuse. */
  isPidRecordCurrent(record: PidRecord): boolean {
    if (!this.isProcessAlive(record.pid) || !record.processStartToken) {
      return false;
    }

    return this.readProcessStartToken(record.pid) === record.processStartToken;
  }

  private parsePidRecord(content: string): PidRecord | undefined {
    const trimmed = content.trim();
    if (!trimmed.startsWith('{')) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed) as Partial<PidRecord>;
      if (
        Number.isInteger(parsed.pid)
        && typeof parsed.pid === 'number'
        && parsed.pid > 0
        && typeof parsed.serverKey === 'string'
        && typeof parsed.instancePath === 'string'
        && typeof parsed.runtimeHomePath === 'string'
        && typeof parsed.writtenAt === 'number'
      ) {
        return {
          pid: parsed.pid,
          serverKey: parsed.serverKey,
          instancePath: parsed.instancePath,
          runtimeHomePath: parsed.runtimeHomePath,
          writtenAt: parsed.writtenAt,
          processStartToken: typeof parsed.processStartToken === 'string' ? parsed.processStartToken : undefined,
          processCommand: typeof parsed.processCommand === 'string' ? parsed.processCommand : undefined,
        };
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private readProcessStartToken(pid: number): string | undefined {
    try {
      if (os.platform() === 'win32') {
        return execFileSync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CreationDate.ToUniversalTime().ToString("o")`,
        ], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        }).trim() || undefined;
      }

      return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private readProcessCommand(pid: number): string | undefined {
    try {
      if (os.platform() === 'win32') {
        return execFileSync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
        ], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        }).trim() || undefined;
      }

      return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private pidPath(serverId: ServerId): string {
    const normalizedServerId = String(serverId);
    const digest = createHash('sha1').update(normalizedServerId).digest('hex').slice(0, 12);
    const safeSegment = normalizedServerId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
    return path.join(this.baseDir, `${safeSegment}.${digest}.pid`);
  }
}

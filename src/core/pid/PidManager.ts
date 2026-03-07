/*
 * src/core/pid/PidManager.ts
 * Persist PID files for crash‑recovery and graceful shutdown.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { workspace } from 'vscode';
import { JSM_PID_DIR_NAME } from '../../constants';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';

export class PidManager {
  private pidDir: string;

  constructor() {
    // use workspace storage or temp dir if no workspace
    const base = workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    this.pidDir = path.join(base, JSM_PID_DIR_NAME);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.pidDir, { recursive: true });
  }

  async write(fileName: string, pid: number): Promise<void> {
    try {
      await this.ensureDir();
      await fs.writeFile(path.join(this.pidDir, fileName), String(pid), 'utf8');
    } catch (e) {
      throw new JsmError(ErrorCode.FS_WRITE, 'Unable to write pid file', e);
    }
  }

  async read(fileName: string): Promise<number | null> {
    try {
      const content = await fs.readFile(path.join(this.pidDir, fileName), 'utf8');
      return Number(content.trim()) || null;
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      throw new JsmError(ErrorCode.FS_READ, 'Unable to read pid file', e);
    }
  }

  async remove(fileName: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.pidDir, fileName));
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        throw new JsmError(ErrorCode.FS_DELETE, 'Unable to remove pid file', e);
      }
    }
  }

  /** Delete any pid file whose process is no longer running */
  async cleanupStale(): Promise<void> {
    try {
      await this.ensureDir();
      const files = await fs.readdir(this.pidDir);
      for (const f of files) {
        const pid = await this.read(f);
        if (pid && !this.isProcessAlive(pid)) {
          await this.remove(f);
        }
      }
    } catch (e) {
      // non‑fatal
    }
  }

  /** 
   * Clean up a specific PID file (remove the file)
   * Used by plugin architecture to clean up after server shutdown
   */
  async cleanup(fileName: string): Promise<void> {
    await this.remove(fileName);
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

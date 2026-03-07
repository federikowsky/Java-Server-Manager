/*
 * LogService - KISS approach
 * Opens server log files in VSCode using the configured server paths.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Uri, window, workspace } from 'vscode';
import { ConfigManager } from '../core/config/ConfigManager';
import { Logger } from '../core/utils/logger';

export class LogService {
  private readonly log = Logger.getInstance().createChild('LogService');

  constructor(
    private readonly configManager?: ConfigManager
  ) {}

  async openServerLog(serverId: string): Promise<void> {
    try {
      this.log.info(`Opening log for server: ${serverId}`);
      
      if (!this.configManager) {
        window.showErrorMessage('Configuration manager not available');
        return;
      }

      // Get server configuration
      const serverResult = await this.configManager.getServer(serverId);
      if (!serverResult.ok) {
        window.showErrorMessage(`Server ${serverId} not found`);
        return;
      }

      const server = serverResult.value;
      const logPath = await this.resolveLogPath(server);
      if (!logPath) {
        window.showWarningMessage(`No log file found for server: ${server.name}`);
        return;
      }

      const doc = await workspace.openTextDocument(Uri.file(logPath));
      await window.showTextDocument(doc);
    } catch (error) {
      this.log.error(`Failed to open server log: ${error}`);
      window.showErrorMessage(`Failed to open server log: ${error}`);
    }
  }

  private async resolveLogPath(server: { serverHome: string; logPath?: string; instancePath?: string }): Promise<string | undefined> {
    const configuredLogPath = server.logPath?.trim();
    if (configuredLogPath && await this.pathExists(configuredLogPath)) {
      return configuredLogPath;
    }

    const baseDir = server.instancePath || server.serverHome;
    const logsDir = path.join(baseDir, 'logs');
    if (!(await this.pathExists(logsDir))) {
      return undefined;
    }

    const preferredFiles = [
      path.join(logsDir, 'catalina.out'),
      path.join(logsDir, 'catalina.log'),
      path.join(logsDir, 'stdout.log')
    ];

    for (const candidate of preferredFiles) {
      if (await this.pathExists(candidate)) {
        return candidate;
      }
    }

    const logFiles = await fs.promises.readdir(logsDir);
    const fallback = logFiles
      .filter((entry) => entry.endsWith('.log') || entry.endsWith('.out') || entry.includes('catalina'))
      .sort()
      .pop();

    return fallback ? path.join(logsDir, fallback) : undefined;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.promises.access(targetPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

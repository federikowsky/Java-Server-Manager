/*
 * LogService - KISS approach
 * Opens server log files in VSCode using plugin system
 */

import { window, workspace } from 'vscode';
import { PluginRegistry } from '../core/server/plugins/index';
import { ConfigManager } from '../core/config/ConfigManager';
import { Logger } from '../core/utils/logger';

export class LogService {
  private readonly log = Logger.getInstance().createChild('LogService');

  constructor(
    private readonly pluginRegistry: PluginRegistry,
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
      
      // Detect server type from serverHome
      const serverTypeResult = await this.pluginRegistry.detectServerType(server.serverHome);
      if (!serverTypeResult.ok) {
        window.showErrorMessage(`Could not detect server type for: ${server.serverHome}`);
        return;
      }
      
      // Get plugin for server type
      const pluginResult = this.pluginRegistry.get(serverTypeResult.value);
      if (!pluginResult.ok) {
        window.showErrorMessage(`No plugin found for server type: ${serverTypeResult.value}`);
        return;
      }

      // Get log path from plugin
      if ('getLogPath' in pluginResult.value) {
        const logPath = (pluginResult.value as any).getLogPath(server);
        if (logPath) {
          // Open log file in VSCode
          const uri = workspace.asRelativePath(logPath);
          const doc = await workspace.openTextDocument(uri);
          await window.showTextDocument(doc);
        } else {
          window.showWarningMessage(`No log file found for server: ${server.name}`);
        }
      } else {
        window.showWarningMessage(`Plugin for ${serverTypeResult.value} does not support log viewing`);
      }
    } catch (error) {
      this.log.error(`Failed to open server log: ${error}`);
      window.showErrorMessage(`Failed to open server log: ${error}`);
    }
  }
}

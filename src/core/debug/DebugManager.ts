/*
 * src/core/debug/DebugManager.ts
 */

import { debug, workspace } from 'vscode';
import * as net from 'net';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Logger } from '../utils/logger';

const BASE_PORT = 50000;
const MAX_SCAN = 1000;

export class DebugManager {
  private readonly logger = Logger.getInstance().createChild('Debug');
  private readonly portCache = new Set<number>();

  async findFreePort(): Promise<number> {
    for (let p = BASE_PORT; p < BASE_PORT + MAX_SCAN; p++) {
      if (!this.portCache.has(p) && await this.isFree(p)) {
        this.portCache.add(p);
        return p;
      }
    }
    throw new JsmError(ErrorCode.PORT_UNAVAILABLE, 'No free port for JDWP');
  }

  /**
   * Alias for findFreePort() to match expected interface in plugin architecture
   */
  async getAvailablePort(): Promise<number> {
    return this.findFreePort();
  }

  private isFree(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }

  async generateLaunchConfig(serverId: string, jdwpPort: number): Promise<string> {
    if (!workspace.workspaceFolders?.[0]) {
      throw new JsmError(ErrorCode.CONFIG_INVALID, 'No workspace folder');
    }
    return `JSM-${serverId}-${jdwpPort}`;
  }

  async attachDebugger(configName: string): Promise<void> {
    const portMatch = configName.match(/-(\d+)$/);
    const port = portMatch ? parseInt(portMatch[1]) : 5005;
    
    const wsFolder = workspace.workspaceFolders?.[0];
    if (!wsFolder) {
      throw new JsmError(ErrorCode.CONFIG_INVALID, 'No workspace folder');
    }

    // Wait for debug port to be available
    await this.waitForDebugPort(port);

    const config = {
      name: configName,
      type: 'java',
      request: 'attach',
      hostName: 'localhost',
      port
    };

    const success = await debug.startDebugging(wsFolder, config);
    if (!success) {
      throw new JsmError(ErrorCode.SERVER_STARTUP_ERROR, 'Failed to attach debugger');
    }

    this.logger.info(`Debugger attached: ${configName}:${port}`);
  }

  private async waitForDebugPort(port: number, maxWait = 10000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      if (await this.isPortListening(port)) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    throw new JsmError(ErrorCode.SERVER_STARTUP_ERROR, `Debug port ${port} not available after ${maxWait}ms`);
  }

  private isPortListening(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.on('error', () => {
        resolve(false);
      });
      
      socket.connect(port, 'localhost');
    });
  }

  async detachDebugger(sessionName: string): Promise<void> {
    const session = debug.activeDebugSession;
    if (session?.name === sessionName) {
      await session.customRequest('disconnect');
    }
  }

  releasePort(port: number): void {
    this.portCache.delete(port);
  }
}

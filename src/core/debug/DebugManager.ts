/*
 * src/core/debug/DebugManager.ts
 * Responsibility: assign JDWP port, generate in‑memory launch config and
 * silently attach VSCode debugger.
 */

import { debug, workspace } from 'vscode';
import * as net from 'net';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Logger } from '../utils/logger';

const BASE_PORT = 50000;
const MAX_SCAN  = 1000;

export class DebugManager {
  private readonly logger = Logger.getInstance().createChild('Debug');

  /** find first free tcp port starting from BASE_PORT */
  async findFreePort(): Promise<number> {
    for (let p = BASE_PORT; p < BASE_PORT + MAX_SCAN; p++) {
      if (await this.isFree(p)) return p;
    }
    throw new JsmError(ErrorCode.PORT_UNAVAILABLE, 'No free port for JDWP');
  }

  private isFree(port: number): Promise<boolean> {
    return new Promise(res => {
      const srv = net.createServer().once('error', () => res(false)).once('listening', () => {
        srv.close(() => res(true));
      }).listen(port, '127.0.0.1');
    });
  }

  /** returns launch config name */
  async generateLaunchConfig(serverId: string, jdwpPort: number): Promise<string> {
    const name = `JSM-${serverId}-${jdwpPort}`;
    const wsFolder = workspace.workspaceFolders?.[0];
    if (!wsFolder) throw new JsmError(ErrorCode.CONFIG_INVALID, 'No workspace folder');

    const cfg = {
      name,
      type: 'java',
      request: 'attach',
      hostName: 'localhost',
      port: jdwpPort
    } as const;

    const debugConfig = (workspace.getConfiguration('launch', wsFolder.uri).get<any[]>('configurations') ?? []);
    debugConfig.push(cfg);
    await workspace.getConfiguration('launch', wsFolder.uri).update('configurations', debugConfig, false);
    return name;
  }

  async attachDebugger(configName: string): Promise<void> {
    const success = await debug.startDebugging(undefined, configName, { noDebug: false });
    if (!success) throw new JsmError(ErrorCode.SERVER_STARTUP_ERROR, 'Unable to attach debugger');
  }

  async detachDebugger(sessionName: string): Promise<void> {
    const sess = debug.activeDebugSession;
    if (sess && sess.name === sessionName) {
      await sess.customRequest('disconnect');
    }
  }
}

/*
 * src/services/LogService.ts
 * Opens server log file in VSCode.
 */

import { workspace, window, Uri } from 'vscode';
import * as path from 'path';
import { ServerManager } from '../core/server/ServerManager';
import { Result, ok, err } from '../core/utils/result';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { Logger } from '../core/utils/logger';

export class LogService {
  private readonly log = Logger.getInstance().createChild('LogSvc');

  constructor(private readonly srvMgr: ServerManager) {}

  async openLog(serverId: string): Promise<Result<void, JsmError>> {
    const rtRes = this.srvMgr.get(serverId);
    if (!rtRes.ok) return err(rtRes.error);

    const cfg = rtRes.value.getConfig();
    const logFile = cfg.logPath ?? path.join(cfg.serverHome, 'logs', 'catalina.out');

    try {
      const doc = await workspace.openTextDocument(Uri.file(logFile));
      await window.showTextDocument(doc, { preview: false });
      return ok(undefined);
    } catch (e) {
      return err(new JsmError(ErrorCode.FS_READ, 'Cannot open log file', e));
    }
  }
}

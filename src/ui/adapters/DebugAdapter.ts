import * as vscode from 'vscode';
import type { DebugAttacher, ServerId } from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

/**
 * Implements the core DebugAttacher interface via vscode.debug (§5.5).
 */
export class DebugAdapter implements DebugAttacher {
  /** Active debug sessions keyed by serverId. */
  private readonly sessions = new Map<ServerId, vscode.DebugSession>();

  async attach(config: {
    port: number;
    name: string;
    bind: string;
  }): Promise<Result<void, JsmError>> {
    const debugConfig: vscode.DebugConfiguration = {
      type: 'java',
      name: config.name,
      request: 'attach',
      hostName: config.bind,
      port: config.port,
    };

    try {
      const started = await vscode.debug.startDebugging(undefined, debugConfig);
      if (!started) {
        return err(new JsmError({
          code: ErrorCode.ProcessSpawnFailed,
          message: `Failed to start debug session '${config.name}' on port ${config.port}`,
        }));
      }

      // Track the session once it starts
      const disposable = vscode.debug.onDidStartDebugSession(session => {
        if (session.name === config.name) {
          // Find serverId from debug session name pattern "Debug: <serverName>"
          // Store by name for lookup during detach
          this.sessions.set(config.name, session);
          disposable.dispose();
        }
      });

      return ok(undefined);
    } catch (cause) {
      return err(new JsmError({
        code: ErrorCode.ProcessSpawnFailed,
        message: `Debug attach error: ${cause instanceof Error ? cause.message : String(cause)}`,
      }));
    }
  }

  async detach(serverId: ServerId): Promise<void> {
    const session = this.sessions.get(serverId);
    if (session) {
      await vscode.debug.stopDebugging(session);
      this.sessions.delete(serverId);
    }
  }
}

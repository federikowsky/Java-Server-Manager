import * as vscode from 'vscode';
import type { DebugAttacher, ServerId } from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

/**
 * Implements the core DebugAttacher interface via vscode.debug (§5.5).
 * Also tracks session state and emits events for debug-attach feature.
 */
export class DebugAdapter implements DebugAttacher {
  /** Active debug sessions keyed by serverId. */
  private readonly sessions = new Map<ServerId, vscode.DebugSession>();
  private readonly disposables: vscode.Disposable[] = [];

  /** Event fired when a debug session is attached or detached for a server. */
  private readonly _onDidChangeSession = new vscode.EventEmitter<{ serverId: ServerId; attached: boolean }>();
  readonly onDidChangeSession = this._onDidChangeSession.event;

  constructor() {
    // Detect external session termination (user stops debugger from VS Code)
    this.disposables.push(
      vscode.debug.onDidTerminateDebugSession(session => {
        for (const [serverId, tracked] of this.sessions) {
          if (tracked.id === session.id) {
            this.sessions.delete(serverId);
            this._onDidChangeSession.fire({ serverId, attached: false });
            break;
          }
        }
      }),
    );
  }

  /** Check if a debug session is currently attached for a server. */
  isAttached(serverId: ServerId): boolean {
    return this.sessions.has(serverId);
  }

  async attach(config: {
    serverId: ServerId;
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
          this.sessions.set(config.serverId, session);
          this._onDidChangeSession.fire({ serverId: config.serverId, attached: true });
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
      this._onDidChangeSession.fire({ serverId, attached: false });
    }
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.sessions.clear();
    this._onDidChangeSession.dispose();
  }
}

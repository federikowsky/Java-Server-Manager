import * as vscode from 'vscode';
import type { ServerId } from '@core/types';
import { JsmError } from '@core/errors/JsmError';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { ServerNode, DeploymentNode } from '@ui/tree/ServerTreeViewProvider';

// ── Error / Success display ─────────────────────────────────────────────────

export function showErr(e: JsmError): void {
  void vscode.window.showErrorMessage(`JSM: ${e.message}`);
}

export function showSuccess(msg: string): void {
  void vscode.window.showInformationMessage(msg);
}

/** Minimal lifecycle surface for queue-backed commands (avoids circular imports). */
export interface QueueProgressLifecycle {
  cancel(serverId: ServerId): void;
  waitUntilQueueIdle(serverId: ServerId): Promise<void>;
  getAndClearQueueDrainFailure(serverId: ServerId): unknown | undefined;
}

export type QueueProgressAction = () => Result<void, JsmError>;

/**
 * Shows a cancellable progress notification while the server operation queue drains.
 * "Annulla" calls `lifecycle.cancel(serverKey)` (same as tree Cancel Operation).
 */
export async function runUntilQueueIdleWithProgress(
  options: { title: string; serverKey: ServerId },
  lifecycle: QueueProgressLifecycle,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.title,
      cancellable: true,
    },
    async (_progress, cancellationToken) => {
      const sub = cancellationToken.onCancellationRequested(() => {
        lifecycle.cancel(options.serverKey);
      });
      try {
        await lifecycle.waitUntilQueueIdle(options.serverKey);
      } finally {
        sub.dispose();
      }
    },
  );
}

/**
 * Same as {@link runUntilQueueIdleWithProgress}, then returns the first executor error from the queue drain (if any).
 */
export async function runUntilQueueIdleWithProgressResult(
  options: { title: string; serverKey: ServerId },
  lifecycle: QueueProgressLifecycle,
): Promise<Result<void, JsmError>> {
  await runUntilQueueIdleWithProgress(options, lifecycle);
  const failure = lifecycle.getAndClearQueueDrainFailure(options.serverKey);
  if (failure === undefined) return ok(undefined);
  if (failure instanceof JsmError) return err(failure);
  return err(JsmError.fromUnknown(failure));
}

/**
 * Runs a queue-producing action and then waits for the queue to drain with the
 * same progress/error semantics used by command handlers.
 */
export async function runQueuedActionWithProgressResult(
  options: { title: string; serverKey: ServerId },
  lifecycle: QueueProgressLifecycle,
  action: QueueProgressAction,
): Promise<Result<void, JsmError>> {
  const actionResult = action();
  if (!actionResult.ok) {
    return err(actionResult.error);
  }

  return runUntilQueueIdleWithProgressResult(options, lifecycle);
}

// ── Deferred command stub ───────────────────────────────────────────────────

export function deferredStub(label: string): () => void {
  return () => {
    void vscode.window.showInformationMessage(
      `"${label}" is planned for v1.1.`,
    );
  };
}

// ── Type guards ─────────────────────────────────────────────────────────────

export function isServerNode(arg: unknown): arg is ServerNode {
  if (arg instanceof ServerNode) return true;
  if (arg instanceof DeploymentNode) return false;
  if (typeof arg !== 'object' || arg === null) return false;
  const candidate = arg as Record<string, unknown>;
  return typeof candidate['serverId'] === 'string' && typeof candidate['workspaceFolderUri'] === 'string';
}

export function isDeploymentNode(arg: unknown): arg is DeploymentNode {
  if (arg instanceof DeploymentNode) return true;
  if (typeof arg !== 'object' || arg === null) return false;
  const candidate = arg as Record<string, unknown>;
  return typeof candidate['serverId'] === 'string' && typeof candidate['deploymentId'] === 'string';
}

// ── Bulk registration ───────────────────────────────────────────────────────

export function registerMany(
  commands: ReadonlyArray<[id: string, handler: (...args: unknown[]) => unknown]>,
): vscode.Disposable[] {
  return commands.map(([id, handler]) => vscode.commands.registerCommand(id, handler));
}

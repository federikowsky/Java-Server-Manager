import * as vscode from 'vscode';
import { createCancellationTokenSource } from '@core/ops';
import type { JsmError } from '@core/errors/JsmError';
import type { OperationContext } from '@core/types';
import { ServerNode, DeploymentNode } from '@ui/tree/ServerTreeViewProvider';

// ── Error / Success display ─────────────────────────────────────────────────

export function showErr(e: JsmError): void {
  void vscode.window.showErrorMessage(`JSM: ${e.message}`);
}

export function showSuccess(msg: string): void {
  void vscode.window.showInformationMessage(msg);
}

interface ProgressOperationOptions {
  title: string;
  serverId: string;
  kind: OperationContext['kind'];
  timeoutMs?: number;
  targetDeploymentId?: string;
}

export async function runWithOperationProgress<T>(
  options: ProgressOperationOptions,
  operation: (ctx: OperationContext) => Promise<T>,
): Promise<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.title,
      cancellable: true,
    },
    async (progress, cancellationToken) => {
      const cancellation = createCancellationTokenSource();
      const subscription = cancellationToken.onCancellationRequested(() => cancellation.cancel());

      try {
        return await operation({
          operationId: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          serverId: options.serverId,
          kind: options.kind,
          targetDeploymentId: options.targetDeploymentId,
          startedAt: Date.now(),
          timeoutMs: options.timeoutMs ?? 60_000,
          cancel: cancellation.token,
          progress: {
            report: (message: string) => progress.report({ message }),
          },
          output: {
            append: () => {},
            appendLine: () => {},
            clear: () => {},
          },
        });
      } finally {
        subscription.dispose();
      }
    },
  );
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

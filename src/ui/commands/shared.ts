import * as vscode from 'vscode';
import type { JsmError } from '@core/errors/JsmError';
import { ServerNode, DeploymentNode } from '@ui/tree/ServerTreeViewProvider';

// ── Error / Success display ─────────────────────────────────────────────────

export function showErr(e: JsmError): void {
  void vscode.window.showErrorMessage(`JSM: ${e.message}`);
}

export function showSuccess(msg: string): void {
  void vscode.window.showInformationMessage(msg);
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
  return arg instanceof ServerNode;
}

export function isDeploymentNode(arg: unknown): arg is DeploymentNode {
  return arg instanceof DeploymentNode;
}

// ── Bulk registration ───────────────────────────────────────────────────────

export function registerMany(
  commands: ReadonlyArray<[id: string, handler: (...args: unknown[]) => unknown]>,
): vscode.Disposable[] {
  return commands.map(([id, handler]) => vscode.commands.registerCommand(id, handler));
}

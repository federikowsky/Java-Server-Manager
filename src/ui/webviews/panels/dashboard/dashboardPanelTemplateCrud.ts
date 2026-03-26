import * as vscode from 'vscode';
import type { CommandExecutionResult, DashboardPanelDeps } from './dashboardPanelTypes';

export async function deleteServerWithConfirm(
  deps: DashboardPanelDeps,
  postError: (message: string) => void,
  syncState: () => void,
  serverId: string,
  workspaceFolderUri: string,
): Promise<void> {
  try {
    const confirmation = await vscode.window.showWarningMessage(
      'Are you sure you want to delete this server?',
      { modal: true },
      'Delete',
    );
    if (confirmation !== 'Delete') {
      return;
    }

    const result = await deps.workspaceRegistry.removeServer({ workspaceFolderUri, serverId });
    if (!result.ok) {
      postError(result.error.message);
      return;
    }
    syncState();
  } catch (e) {
    deps.logger.error('Error deleting server', e);
    postError(`Error deleting server: ${String(e)}`);
  }
}

export async function saveTemplateFromWebview(
  deps: DashboardPanelDeps,
  postError: (message: string) => void,
  syncState: () => void,
  template: unknown,
  scope: 'global' | 'workspace',
): Promise<CommandExecutionResult> {
  try {
    const result = await deps.templateService.save(template as any, scope);
    if (!result.ok) {
      postError(result.error.message);
      return { ok: false, message: result.error.message };
    }
    syncState();
    return { ok: true };
  } catch (e) {
    deps.logger.error('Error saving template', e);
    const message = `Error saving template: ${String(e)}`;
    postError(message);
    return { ok: false, message };
  }
}

export async function deleteTemplateWithConfirm(
  deps: DashboardPanelDeps,
  postError: (message: string) => void,
  syncState: () => void,
  templateId: string,
  scope: 'global' | 'workspace',
): Promise<CommandExecutionResult> {
  try {
    const confirmation = await vscode.window.showWarningMessage(
      'Are you sure you want to delete this template?',
      { modal: true },
      'Delete',
    );
    if (confirmation !== 'Delete') {
      return { ok: false, message: 'Template deletion cancelled.' };
    }

    const result = await deps.templateService.delete(templateId, scope);
    if (!result.ok) {
      postError(result.error.message);
      return { ok: false, message: result.error.message };
    }
    syncState();
    return { ok: true };
  } catch (e) {
    deps.logger.error('Error deleting template', e);
    const message = `Error deleting template: ${String(e)}`;
    postError(message);
    return { ok: false, message };
  }
}

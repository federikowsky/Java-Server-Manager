import * as path from 'path';
import * as vscode from 'vscode';
import type { OperationContext, ServerConfig } from '@core/types';
import type { Result } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { DeploymentService } from '@app/deployment/DeploymentService';
import type { DiagnosticsService } from '@app/diagnostics/DiagnosticsService';
import type { WorkspaceServiceRegistry, WorkspaceScope } from '@app/config';
import { exists } from '@infra/fs';
import type { ServerLogChannel } from '@ui/channels/ServerLogChannel';
import type { ServerTreeViewProvider } from '@ui/tree/ServerTreeViewProvider';
import type { ServerFormPanel } from '@ui/webviews/panels/ServerFormPanel';
import {
  deferredStub,
  isServerNode,
  registerMany,
  showErr,
  showSuccess,
} from './shared';

export interface ServerCommandsDeps {
  lifecycle: ServerLifecycle;
  workspaceRegistry?: WorkspaceServiceRegistry;
  configService?: {
    getServer(serverId: string): ServerConfig | undefined;
    reload(): Promise<Result<unknown, JsmError>>;
  };
  provisioningService?: {
    removeServer(serverId: string): Promise<Result<void, JsmError>>;
  };
  deployService: DeploymentService;
  diagnosticsService: DiagnosticsService;
  logChannel: ServerLogChannel;
  treeProvider: ServerTreeViewProvider;
  serverFormPanel: ServerFormPanel | {
    open?(mode: 'create' | 'edit', serverId?: string): void;
    openCreate?(workspaceFolderUri: string): void;
    openEdit?(locator: { workspaceFolderUri: string; serverId: string }): void;
  };
}

async function pickWorkspaceScope(scopes: WorkspaceScope[]): Promise<WorkspaceScope | undefined> {
  if (scopes.length === 0) return undefined;
  if (scopes.length === 1) return scopes[0];

  return vscode.window.showQuickPick(
    scopes.map(scope => ({
      label: scope.name,
      description: scope.fsPath,
      scope,
    })),
    {
      placeHolder: 'Select the workspace folder that will own this server',
      ignoreFocusOut: true,
    },
  ).then(selection => selection?.scope);
}

function makeOpCtx(serverId: string, kind: OperationContext['kind']): OperationContext {
  return {
    operationId: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    serverId,
    kind,
    startedAt: Date.now(),
    timeoutMs: 60_000,
    cancel: { isCancelled: false, onCancelled: () => ({ dispose: () => {} }) },
    progress: { report: () => {} },
    output: { append: () => {}, appendLine: () => {}, clear: () => {} },
  };
}

async function revealFolder(targetPath: string): Promise<void> {
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
}

export function registerServerCommands(
  deps: ServerCommandsDeps,
): vscode.Disposable[] {
  const {
    lifecycle,
    workspaceRegistry,
    configService,
    provisioningService,
    deployService,
    diagnosticsService,
    logChannel,
    treeProvider,
    serverFormPanel,
  } = deps;

  const resolveServer = (workspaceFolderUri: string, serverId: string) => workspaceRegistry
    ? workspaceRegistry.getServer({ workspaceFolderUri, serverId })
    : configService?.getServer(serverId);

  return registerMany([
    ['jsm.server.add', async () => {
      if (!workspaceRegistry) {
        serverFormPanel.open?.('create');
        return;
      }

      const scope = await pickWorkspaceScope(workspaceRegistry.getWorkspaceScopes());
      if (!scope) return;
      if (serverFormPanel.openCreate) {
        serverFormPanel.openCreate(scope.uri);
        return;
      }
      serverFormPanel.open?.('create');
    }],

    ['jsm.server.startRun', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.start(arg.serverKey, 'run');
      if (!result.ok) showErr(result.error);
    }],

    ['jsm.server.startDebug', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.start(arg.serverKey, 'debug');
      if (!result.ok) showErr(result.error);
    }],

    ['jsm.server.stop', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.stop(arg.serverKey);
      if (!result.ok) showErr(result.error);
    }],

    ['jsm.server.restartRun', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.restart(arg.serverKey, 'run');
      if (!result.ok) showErr(result.error);
    }],

    ['jsm.server.restartDebug', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.restart(arg.serverKey, 'debug');
      if (!result.ok) showErr(result.error);
    }],

    ['jsm.server.cancelOperation', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      lifecycle.cancel(arg.serverKey);
    }],

    ['jsm.server.edit', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      if (serverFormPanel.openEdit) {
        serverFormPanel.openEdit({
          workspaceFolderUri: arg.workspaceFolderUri,
          serverId: arg.serverId,
        });
        return;
      }
      serverFormPanel.open?.('edit', arg.serverId);
    }],

    ['jsm.server.duplicate', deferredStub('Duplicate Server')],

    ['jsm.server.remove', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const answer = await vscode.window.showWarningMessage(
        `Remove server "${arg.serverConfig.name}"? This cannot be undone.`,
        { modal: true },
        'Remove',
      );
      if (answer !== 'Remove') return;

      const result = workspaceRegistry
        ? await workspaceRegistry.getEntry(arg.workspaceFolderUri)?.provisioningService.removeServer(arg.serverId)
        : await provisioningService?.removeServer(arg.serverId);
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Server "${arg.serverConfig.name}" removed.`);
      treeProvider.requestRefresh();
    }],

    ['jsm.server.openFolder', async (arg: unknown) => {
      if (!isServerNode(arg)) return;

      const configuredPath = arg.serverConfig.instancePath.trim();
      if (!configuredPath) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `Folder path is missing for server '${arg.serverConfig.name}'.`,
        }));
        return;
      }

      if (await exists(configuredPath)) {
        await revealFolder(configuredPath);
        return;
      }

      const fallbackPath = path.dirname(configuredPath);
      if (fallbackPath && fallbackPath !== configuredPath && await exists(fallbackPath)) {
        await revealFolder(fallbackPath);
        return;
      }

      showErr(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Folder is not accessible for server '${arg.serverConfig.name}'.`,
        details: configuredPath,
      }));
    }],

    ['jsm.server.openLogs', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      logChannel.showLogs(arg.serverKey, arg.serverConfig.name);
    }],

    ['jsm.server.syncAllDeployments', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      if (!config || config.deployments.length === 0) return;
      const ctx = makeOpCtx(arg.serverKey, 'SyncAll');
      await deployService.redeployAll(ctx, config);
      showSuccess(`Sync All completed for "${arg.serverConfig.name}".`);
    }],

    ['jsm.server.fullRedeployAll', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      if (!config || config.deployments.length === 0) return;
      const ctx = makeOpCtx(arg.serverKey, 'RedeployAll');
      await deployService.redeployAll(ctx, config);
      showSuccess(`Full Redeploy All completed for "${arg.serverConfig.name}".`);
    }],

    ['jsm.view.refresh', async () => {
      const result = workspaceRegistry
        ? await workspaceRegistry.reloadAll()
        : await configService?.reload();
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      treeProvider.forceRefresh();
    }],

    ['jsm.diagnostics.copy', async () => {
      const text = diagnosticsService.generateBundleText();
      await vscode.env.clipboard.writeText(text);
      showSuccess('Diagnostics copied to clipboard.');
    }],
  ]);
}

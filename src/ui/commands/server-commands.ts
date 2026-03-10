import * as vscode from 'vscode';
import type { OperationContext } from '@core/types';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { DeploymentService } from '@app/deployment/DeploymentService';
import type { DiagnosticsService } from '@app/diagnostics/DiagnosticsService';
import type { WorkspaceServiceRegistry, WorkspaceScope } from '@app/config';
import type { ServerLogChannel } from '@ui/channels/ServerLogChannel';
import type { ServerTreeViewProvider } from '@ui/tree/ServerTreeViewProvider';
import type { ServerFormPanel } from '@ui/webviews/panels/ServerFormPanel';
import {
  showErr,
  showSuccess,
  deferredStub,
  isServerNode,
  registerMany,
} from './shared';

// ── Dependency contract ─────────────────────────────────────────────────────

export interface ServerCommandsDeps {
  lifecycle: ServerLifecycle;
  workspaceRegistry?: WorkspaceServiceRegistry;
  configService?: {
    getServer(serverId: string): any;
    reload(): Promise<any>;
  };
  provisioningService?: {
    removeServer(serverId: string): Promise<{ ok: boolean; error?: JsmError }>;
    repairServer?(serverId: string): Promise<{ ok: boolean; error?: JsmError }>;
    rebuildServer?(serverId: string): Promise<{ ok: boolean; error?: JsmError }>;
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
  configFilePath?: string;
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

function ensureRepairableState(
  lifecycle: ServerLifecycle,
  serverKey: string,
  serverName: string,
): JsmError | undefined {
  const state = lifecycle.getRuntime(serverKey)?.state ?? 'stopped';
  if (state !== 'stopped' && state !== 'error') {
    return new JsmError({
      code: ErrorCode.OperationInProgress,
      message: `Stop server '${serverName}' before repairing or rebuilding its managed instance.`,
    });
  }
  return undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── Registration ────────────────────────────────────────────────────────────

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
    configFilePath,
  } = deps;

  const resolveServer = (workspaceFolderUri: string, serverId: string) => workspaceRegistry
    ? workspaceRegistry.getServer({ workspaceFolderUri, serverId })
    : configService?.getServer(serverId);

  return registerMany([

    // §8.1 — jsm.server.add
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

    // §8.1 — jsm.server.startRun
    ['jsm.server.startRun', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.start(arg.serverKey, 'run');
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.startDebug
    ['jsm.server.startDebug', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.start(arg.serverKey, 'debug');
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.stop
    ['jsm.server.stop', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.stop(arg.serverKey);
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.restartRun
    ['jsm.server.restartRun', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.restart(arg.serverKey, 'run');
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.restartDebug
    ['jsm.server.restartDebug', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.restart(arg.serverKey, 'debug');
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.cancelOperation
    ['jsm.server.cancelOperation', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      lifecycle.cancel(arg.serverKey);
    }],

    // §8.1 — jsm.server.refreshStatus
    ['jsm.server.refreshStatus', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.refreshStatus(arg.serverKey);
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.edit
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

    // §8.1 — jsm.server.duplicate (deferred-v1.1)
    ['jsm.server.duplicate', deferredStub('Duplicate Server')],

    // §8.1 — jsm.server.remove
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

    ['jsm.server.repairInstance', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const stateError = ensureRepairableState(lifecycle, arg.serverKey, arg.serverConfig.name);
      if (stateError) { showErr(stateError); return; }

      const result = workspaceRegistry
        ? await workspaceRegistry.getEntry(arg.workspaceFolderUri)?.provisioningService.repairServer(arg.serverId)
        : await provisioningService?.repairServer?.(arg.serverId);
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Managed instance repaired for "${arg.serverConfig.name}".`);
      treeProvider.requestRefresh();
    }],

    ['jsm.server.rebuildInstance', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const stateError = ensureRepairableState(lifecycle, arg.serverKey, arg.serverConfig.name);
      if (stateError) { showErr(stateError); return; }

      const answer = await vscode.window.showWarningMessage(
        `Rebuild managed instance for server "${arg.serverConfig.name}"? Existing runtime data inside the managed instance will be recreated.`,
        { modal: true },
        'Rebuild',
      );
      if (answer !== 'Rebuild') return;

      const result = workspaceRegistry
        ? await workspaceRegistry.getEntry(arg.workspaceFolderUri)?.provisioningService.rebuildServer(arg.serverId)
        : await provisioningService?.rebuildServer?.(arg.serverId);
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Managed instance rebuilt for "${arg.serverConfig.name}".`);
      treeProvider.requestRefresh();
    }],

    // §8.1 — jsm.server.openConfig
    ['jsm.server.openConfig', async (arg: unknown) => {
      const resolvedConfigFilePath = isServerNode(arg)
        ? workspaceRegistry?.getConfigFilePath(arg.workspaceFolderUri) ?? configFilePath
        : configFilePath;
      if (!resolvedConfigFilePath) return;
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(resolvedConfigFilePath),
      );
      await vscode.window.showTextDocument(doc);
    }],

    // §8.1 — jsm.server.openHome (deferred-v1.1)
    ['jsm.server.openHome', deferredStub('Open Server Home')],

    // §8.1 — jsm.server.openLogs
    ['jsm.server.openLogs', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      logChannel.showLogs(arg.serverKey, arg.serverConfig.name);
    }],

    // §8.1 — jsm.server.syncAllDeployments
    ['jsm.server.syncAllDeployments', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      if (!config || config.deployments.length === 0) return;
      const ctx = makeOpCtx(arg.serverKey, 'SyncAll');
      await deployService.redeployAll(ctx, config);
      showSuccess(`Sync All completed for "${arg.serverConfig.name}".`);
    }],

    // §8.1 — jsm.server.fullRedeployAll
    ['jsm.server.fullRedeployAll', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      if (!config || config.deployments.length === 0) return;
      const ctx = makeOpCtx(arg.serverKey, 'RedeployAll');
      await deployService.redeployAll(ctx, config);
      showSuccess(`Full Redeploy All completed for "${arg.serverConfig.name}".`);
    }],

    // §8.3 — jsm.view.refresh
    ['jsm.view.refresh', async () => {
      const result = workspaceRegistry
        ? await workspaceRegistry.reloadAll()
        : await configService?.reload();
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      treeProvider.forceRefresh();
    }],

    // §8.3 — jsm.diagnostics.copy
    ['jsm.diagnostics.copy', async () => {
      const text = diagnosticsService.generateBundleText();
      await vscode.env.clipboard.writeText(text);
      showSuccess('Diagnostics copied to clipboard.');
    }],
  ]);
}

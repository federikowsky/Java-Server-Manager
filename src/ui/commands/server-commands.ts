import * as vscode from 'vscode';
import type { OperationContext } from '@core/types';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { ConfigService } from '@app/config/ConfigService';
import type { DeploymentService } from '@app/deployment/DeploymentService';
import type { DiagnosticsService } from '@app/diagnostics/DiagnosticsService';
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
  configService: ConfigService;
  deployService: DeploymentService;
  diagnosticsService: DiagnosticsService;
  logChannel: ServerLogChannel;
  treeProvider: ServerTreeViewProvider;
  serverFormPanel: ServerFormPanel;
  configFilePath: string;
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
    configService,
    deployService,
    diagnosticsService,
    logChannel,
    treeProvider,
    serverFormPanel,
    configFilePath,
  } = deps;

  return registerMany([

    // §8.1 — jsm.server.add
    ['jsm.server.add', () => {
      serverFormPanel.open('create');
    }],

    // §8.1 — jsm.server.startRun
    ['jsm.server.startRun', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.start(arg.serverId, 'run');
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.startDebug
    ['jsm.server.startDebug', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.start(arg.serverId, 'debug');
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.stop
    ['jsm.server.stop', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.stop(arg.serverId);
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.restartRun
    ['jsm.server.restartRun', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.restart(arg.serverId, 'run');
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.restartDebug
    ['jsm.server.restartDebug', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.restart(arg.serverId, 'debug');
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.cancelOperation
    ['jsm.server.cancelOperation', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      lifecycle.cancel(arg.serverId);
    }],

    // §8.1 — jsm.server.refreshStatus
    ['jsm.server.refreshStatus', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.refreshStatus(arg.serverId);
      if (!result.ok) showErr(result.error);
    }],

    // §8.1 — jsm.server.edit
    ['jsm.server.edit', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      serverFormPanel.open('edit', arg.serverId);
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

      const result = await configService.removeServer(arg.serverId);
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Server "${arg.serverConfig.name}" removed.`);
      treeProvider.requestRefresh();
    }],

    // §8.1 — jsm.server.openConfig
    ['jsm.server.openConfig', async () => {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(configFilePath),
      );
      await vscode.window.showTextDocument(doc);
    }],

    // §8.1 — jsm.server.openHome (deferred-v1.1)
    ['jsm.server.openHome', deferredStub('Open Server Home')],

    // §8.1 — jsm.server.openLogs
    ['jsm.server.openLogs', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      logChannel.showLogs(arg.serverId, arg.serverConfig.name);
    }],

    // §8.1 — jsm.server.syncAllDeployments
    ['jsm.server.syncAllDeployments', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const config = configService.getServer(arg.serverId);
      if (!config || config.deployments.length === 0) return;
      const ctx = makeOpCtx(arg.serverId, 'SyncAll');
      await deployService.redeployAll(ctx, config);
      showSuccess(`Sync All completed for "${arg.serverConfig.name}".`);
    }],

    // §8.1 — jsm.server.fullRedeployAll
    ['jsm.server.fullRedeployAll', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const config = configService.getServer(arg.serverId);
      if (!config || config.deployments.length === 0) return;
      const ctx = makeOpCtx(arg.serverId, 'RedeployAll');
      await deployService.redeployAll(ctx, config);
      showSuccess(`Full Redeploy All completed for "${arg.serverConfig.name}".`);
    }],

    // §8.3 — jsm.view.refresh
    ['jsm.view.refresh', async () => {
      await configService.reload();
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

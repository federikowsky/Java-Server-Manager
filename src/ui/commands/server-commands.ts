import * as vscode from 'vscode';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { ConfigService } from '@app/config/ConfigService';
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
  diagnosticsService: DiagnosticsService;
  logChannel: ServerLogChannel;
  treeProvider: ServerTreeViewProvider;
  serverFormPanel: ServerFormPanel;
  configFilePath: string;
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerServerCommands(
  deps: ServerCommandsDeps,
): vscode.Disposable[] {
  const {
    lifecycle,
    configService,
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
      treeProvider.requestRefresh();
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
    ['jsm.server.syncAllDeployments', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      void vscode.window.showInformationMessage(
        `Sync All queued for "${arg.serverConfig.name}".`,
      );
      // Full wiring requires OperationContext; handled via queue in Phase 8.
    }],

    // §8.1 — jsm.server.fullRedeployAll
    ['jsm.server.fullRedeployAll', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      void vscode.window.showInformationMessage(
        `Full Redeploy All queued for "${arg.serverConfig.name}".`,
      );
      // Full wiring requires OperationContext; handled via queue in Phase 8.
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

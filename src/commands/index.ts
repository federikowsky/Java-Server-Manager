/*
 * src/commands/index.ts
 * Registers VSCode commands and delegates to Services layer.
 */

import {
  ExtensionContext,
  commands,
  window,
  QuickPickItem,
  Uri
} from 'vscode';
import { ServerNode } from '../ui/views/ServerTreeViewProvider';

import { ServerService } from '../services/ServerService';
import { DeploymentService } from '../services/DeploymentService';
import { AutoSyncService } from '../services/AutoSyncService';
import { GlobalTemplateManager } from '../core/config/GlobalTemplateManager';
import { Logger } from '../core/utils/logger';
import { JsmError } from '../core/errors/JsmError';

const log = Logger.getInstance().createChild('Cmd');

/* ───────────────────────── helper ───────────────────────── */
function showErr(e: unknown) {
  if (e instanceof JsmError) window.showErrorMessage(`JSM: ${e.message}`);
  else window.showErrorMessage('JSM: unexpected error');
}

/* ───────────────────────── Server commands ───────────────────────── */
export function registerServerCommands(ctx: ExtensionContext, srv: ServerService) {
  ctx.subscriptions.push(
    commands.registerCommand('jsm.server.start', async (args: { id: string; mode: 'run' | 'debug' }) => {
      console.log('🎯 Command: jsm.server.start called with args:', args);
      const res = await srv.start(args.id, args.mode);
      if (!res.ok) showErr(res.error);
    }),

    commands.registerCommand('jsm.server.stop', async (id: string) => {
      console.log('🎯 Command: jsm.server.stop called with id:', id);
      const res = await srv.stop(id);
      if (!res.ok) showErr(res.error);
    }),

    commands.registerCommand('jsm.server.restart', async (args: { id: string; mode: 'run' | 'debug' }) => {
      console.log('🎯 Command: jsm.server.restart called with args:', args);
      const res = await srv.restart(args.id, args.mode);
      if (!res.ok) showErr(res.error);
    }),

    commands.registerCommand('jsm.server.delete', async (node: ServerNode) => {
      console.log('🎯 Command: jsm.server.delete called with node:', node);
      const id = node.data.id; // Extract the ID from the ServerNode
      const res = await srv.delete(id);
      if (!res.ok) showErr(res.error);
    }),

    commands.registerCommand('jsm.server.create', async () => {
      console.log('🎯 Command: jsm.server.create called');
      const testServer = {
        id: 'test-server-' + Date.now(),
        name: 'Test Server ' + new Date().toLocaleTimeString(),
        type: 'tomcat' as const,
        javaHome: '/System/Library/Frameworks/JavaVM.framework/Versions/Current',
        serverHome: '/opt/tomcat',
        host: 'localhost',
        port: 8080,
        debug: { enable: false },
        autoSync: false,
        pidFile: 'test-server.pid',
        state: 'stopped' as const,
        deployments: []
      };
      const res = await srv.create(testServer);
      if (!res.ok) {
        showErr(res.error);
      } else {
        window.showInformationMessage(`Created server: ${testServer.name}`);
      }
    }),

    commands.registerCommand('jsm.treeview.refresh', () => {
      console.log('🎯 Command: jsm.treeview.refresh called');
      // Trigger a manual refresh by reloading workspace
      srv.loadWorkspace();
    })
  );
}

/* ───────────────────────── Deployment commands ──────────────────── */
export function registerDeploymentCommands(
  ctx: ExtensionContext,
  dep: DeploymentService,
  sync: AutoSyncService
) {
  ctx.subscriptions.push(
    commands.registerCommand('jsm.deployment.forceDeploy', async (args: { srvId: string; depId: string }) => {
      const res = await dep.forceDeploy(args.srvId, args.depId);
      if (!res.ok) showErr(res.error);
    }),

    commands.registerCommand('jsm.deployment.undeploySoft', async (args: { srvId: string; depId: string }) => {
      const res = await dep.undeploySoft({ serverId: args.srvId, deploymentId: args.depId });
      if (!res.ok) showErr(res.error);
    }),

    commands.registerCommand('jsm.deployment.toggleAutosync', (args: { srvId: string; depId: string }) => {
      const res = sync.toggle(args.srvId, args.depId);
      if (!res.ok) showErr(res.error);
    })
  );
}

/* ───────────────────────── Template commands ────────────────────── */
export function registerTemplateCommands(ctx: ExtensionContext) {
  const tplMgr = new GlobalTemplateManager(ctx.globalStorageUri.fsPath);

  ctx.subscriptions.push(
    commands.registerCommand('jsm.templates.delete', async () => {
      const list = tplMgr.list();
      if (!list.ok) return showErr(list.error);
      const pick = await window.showQuickPick(
        list.value.map<QuickPickItem>(t => ({ label: t.name, description: t.id })),
        { title: 'Delete Template' }
      );
      if (!pick) return;
      const confirm = await window.showWarningMessage('Delete template?', { modal: true }, 'Delete');
      if (confirm !== 'Delete') return;
      const del = tplMgr.delete(pick.description!);
      if (!del.ok) showErr(del.error);
    })
  );
}

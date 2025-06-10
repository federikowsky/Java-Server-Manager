/*
 * src/extension.ts
 * VS Code entry‑point for Java Server Manager
 */

import {
  ExtensionContext,
  commands,
  window,
  workspace,
  Disposable
} from 'vscode';

import { Logger } from './core/utils/logger';
import { EventBus } from './core/EventBus';
import { HookManager } from './core/hooks/HookManager';
import { PidManager } from './core/pid/PidManager';
import { DebugManager } from './core/debug/DebugManager';
import { ConfigService } from './core/config/ConfigService';
import { ServerManager } from './core/server/ServerManager';
import { ServerService } from './services/ServerService';
import { DeploymentService } from './services/DeploymentService';
import { AutoSyncService } from './services/AutoSyncService';
import { LogService } from './services/LogService';

/* UI */
import { ServerTreeViewProvider } from './ui/views/ServerTreeViewProvider';
import {
  registerServerCommands,
  registerDeploymentCommands,
  registerTemplateCommands
} from './commands';

/* ────────────────────────────────────────────────────────────────── */
const singleton = {
  logger:  Logger.getInstance(),
  bus:     EventBus.getInstance(),
  hooks:   HookManager.getInstance()
};

export async function activate(ctx: ExtensionContext): Promise<void> {
  console.log('🚀 JSM: Starting activation...');
  singleton.logger.info('Activating Java Server Manager…');

  // Check if workspace folders exist
  if (!workspace.workspaceFolders || workspace.workspaceFolders.length === 0) {
    console.error('❌ JSM: No workspace folders found!');
    window.showErrorMessage('Java Server Manager requires an open workspace folder.');
    return;
  }

  console.log('✅ JSM: Workspace folder found:', workspace.workspaceFolders[0].uri.fsPath);

  /* Services instantiation  */
  const pidMgr  = new PidManager();
  const dbgMgr  = new DebugManager();
  const cfgSvc  = new ConfigService(workspace.workspaceFolders![0].uri);
  const srvMgr  = new ServerManager();
  const srvSvc  = new ServerService(cfgSvc, pidMgr, srvMgr, singleton.bus, singleton.hooks, dbgMgr);
  const depSvc  = new DeploymentService(cfgSvc, srvMgr, singleton.bus, singleton.hooks);
  const syncSvc = new AutoSyncService(depSvc);
  const logSvc  = new LogService(srvMgr);

  /* Register VSCode commands */
  registerServerCommands(ctx, srvSvc);
  registerDeploymentCommands(ctx, depSvc, syncSvc);
  registerTemplateCommands(ctx);

  /* Tree‑view */
  console.log('🌳 JSM: Creating TreeView...');
  const treeProv = new ServerTreeViewProvider(srvSvc, singleton.bus, singleton.logger);
  ctx.subscriptions.push(treeProv);
  
  // Register the tree view
  console.log('🌳 JSM: Registering TreeView with ID: javaServerManagerView');
  const treeView = window.createTreeView('javaServerManagerView', {
    treeDataProvider: treeProv,
    showCollapseAll: true
  });
  ctx.subscriptions.push(treeView);
  console.log('✅ JSM: TreeView registered successfully');

  /* Load workspace servers */
  console.log('📂 JSM: Loading workspace servers...');
  const res = await srvSvc.loadWorkspace();
  if (!res.ok) {
    console.error('❌ JSM: Failed to load servers:', res.error);
    window.showErrorMessage('JSM: unable to load servers configuration.');
  } else {
    console.log('✅ JSM: Servers loaded successfully');
  }

  /* cleanup on deactivate */
  ctx.subscriptions.push(new Disposable(async () => {
    await deactivate();
  }));

  console.log('🎉 JSM: Activation completed!');
  singleton.logger.info('JSM activated');
}

export async function deactivate(): Promise<void> {
  singleton.logger.info('Deactivating JSM…');
  const pidMgr = new PidManager();
  const srvSvc = new ServerService(
    new ConfigService(workspace.workspaceFolders![0].uri),
    pidMgr,
    new ServerManager(),
    singleton.bus,
    singleton.hooks,
    new DebugManager()
  );
  await srvSvc.stopAllRunning();
  singleton.bus.disposeAllListeners();
}

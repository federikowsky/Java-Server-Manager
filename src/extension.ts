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
  singleton.logger.info('Activating Java Server Manager…');

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
  const treeProv = new ServerTreeViewProvider(srvSvc, singleton.bus, singleton.logger);
  ctx.subscriptions.push(treeProv);

  /* Load workspace servers */
  const res = await srvSvc.loadWorkspace();
  if (!res.ok) {
    window.showErrorMessage('JSM: unable to load servers configuration.');
  }

  /* cleanup on deactivate */
  ctx.subscriptions.push(new Disposable(async () => {
    await deactivate();
  }));

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

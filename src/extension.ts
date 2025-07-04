/*
 * src/extension.ts
 * VS Code entry-point for Java Server Manager with new ConfigManager system
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
import { ConfigManager } from './core/config/ConfigManager';
import { PluginRegistry } from './core/server/plugins/index';
import { ServerManager } from './core/server/ServerManager';
import { PluginAdapter } from './core/server/PluginAdapter';
import { ServerService } from './services/ServerService';
import { DeploymentService } from './services/DeploymentService';
import { AutoSyncService } from './services/AutoSyncService';
import { LogService } from './services/LogService';

/* UI */
import { ServerTreeViewProvider } from './ui/views/ServerTreeViewProvider';
import {
  registerServerCommands,
  registerDeploymentCommands
  // registerTemplateCommands // Temporarily disabled
} from './commands';

/* ────────────────────────────────────────────────────────────────── */
const singleton = {
  logger: Logger.getInstance(),
  bus: EventBus.getInstance(),
  hooks: HookManager.getInstance(),
  configManager: null as ConfigManager | null
};

export async function activate(ctx: ExtensionContext): Promise<void> {
  singleton.logger.info('Activating Java Server Manager with new configuration system…');

  // Check if workspace folders exist
  if (!workspace.workspaceFolders || workspace.workspaceFolders.length === 0) {
    console.error('❌ JSM: No workspace folders found!');
    window.showErrorMessage('Java Server Manager requires an open workspace folder.');
    return;
  }

  try {
    /* Initialize New Configuration System */
    singleton.logger.info('Initializing new configuration system...');
    
    const initResult = await ConfigManager.initialize(workspace.workspaceFolders![0].uri);
    if (!initResult.ok) {
      singleton.logger.error('Failed to initialize configuration system:', initResult.error);
      window.showErrorMessage(`Configuration system initialization failed: ${initResult.error.message}`);
      return;
    }

    singleton.configManager = ConfigManager.getInstance();
    
    singleton.logger.info('Configuration system initialized successfully');

    /* Initialize Modernized Plugin System */
    singleton.logger.info('Initializing modernized plugin system...');
    
    // Simple plugin configuration - no complex manager needed
    const pluginRegistry = PluginRegistry.getInstance();
    
    // Log plugin system status
    const supportedTypes = pluginRegistry.getSupportedTypes();
    singleton.logger.info(`Plugin registry initialized with ${supportedTypes.length} supported server types: ${supportedTypes.join(', ')}`);

    /* Services instantiation with new configuration system */
    const pidMgr = new PidManager();
    const dbgMgr = new DebugManager();
    
    // Create services using new ConfigManager and new architecture
    singleton.logger.info('Creating services with new event-driven architecture');
    
    // Initialize the new event-driven ServerManager
    const serverManager = ServerManager.getInstance();
    const pluginAdapter = PluginAdapter.getInstance();
    
    const srvSvc = new ServerService(singleton.configManager, pidMgr, singleton.bus, singleton.hooks, dbgMgr);
    const depSvc = new DeploymentService(singleton.configManager, pluginRegistry, singleton.bus, singleton.hooks);
    const logSvc = new LogService(pluginRegistry, singleton.configManager);
    
    singleton.logger.info('Modern services initialized successfully');

    const syncSvc = new AutoSyncService(depSvc);

    /* Register VSCode commands */
    registerServerCommands(ctx, srvSvc, logSvc);
    registerDeploymentCommands(ctx, depSvc, syncSvc);
    // Template commands temporarily disabled - need to refactor for new architecture
    // registerTemplateCommands(ctx, pluginSrvSvc);

    /* Tree-view */
    const treeProv = new ServerTreeViewProvider(srvSvc, singleton.bus, singleton.logger);
    ctx.subscriptions.push(treeProv);
    
    // Register the tree view
    const treeView = window.createTreeView('javaServerManagerView', {
      treeDataProvider: treeProv,
      showCollapseAll: true
    });
    ctx.subscriptions.push(treeView);

    /* Load workspace servers using server service */
    const loadResult = await srvSvc.getAllServers();
    if (!loadResult.ok) {
      console.error('❌ JSM: Failed to load servers:', loadResult.error);
      window.showErrorMessage('JSM: unable to load servers configuration.');
    } else {
      console.log(`✅ JSM: Loaded ${loadResult.value.length} servers successfully`);
    }

    /* cleanup on deactivate */
    ctx.subscriptions.push(new Disposable(async () => {
      await deactivate();
    }));

    singleton.logger.info('JSM activated with new configuration system');
  } catch (error) {
    singleton.logger.error('Failed to activate JSM:', error);
    console.error('❌ JSM: Activation failed:', error);
    window.showErrorMessage(`Java Server Manager: Activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function deactivate(): Promise<void> {
  singleton.logger.info('Deactivating JSM…');
  
  try {
    // Dispose configuration manager
    if (singleton.configManager) {
      await singleton.configManager.dispose();
      singleton.configManager = null;
    }

    // Stop all running servers using ServerManager
    if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
      const serverManager = ServerManager.getInstance();
      await serverManager.dispose();
    }

    // Dispose plugin registry
    const pluginRegistry = PluginRegistry.getInstance();
    await pluginRegistry.dispose();

    // Dispose event bus
    singleton.bus.disposeAllListeners();

    singleton.logger.info('JSM deactivated');
  } catch (error) {
    singleton.logger.error('Error during deactivation:', error);
    console.error('❌ JSM: Deactivation error:', error);
  }
}

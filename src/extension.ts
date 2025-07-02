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
import { PluginRegistry } from './core/plugins/index';
import { ServerRuntimeManager } from './core/plugins/runtime/ServerRuntimeManager';
// TODO: Replace PluginConfigManager with proper configuration management
// import { PluginConfigManager } from './core/config/PluginConfig';
import { ServerService } from './services/ServerService';
import { PluginServerService } from './services/PluginServerService';
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
    const runtimeManager = ServerRuntimeManager.getInstance();
    
    // Log plugin system status
    const supportedTypes = pluginRegistry.getSupportedTypes();
    singleton.logger.info(`Plugin registry initialized with ${supportedTypes.length} supported server types: ${supportedTypes.join(', ')}`);

    /* Services instantiation with new configuration system */
    const pidMgr = new PidManager();
    const dbgMgr = new DebugManager();
    
    // Create services using new ConfigManager
    singleton.logger.info('Creating services with new configuration system');
    
    const srvSvc = new ServerService(singleton.configManager, pidMgr, singleton.bus, singleton.hooks, dbgMgr);
    const pluginSrvSvc = new PluginServerService(
      singleton.configManager,
      pidMgr,
      singleton.bus,
      singleton.hooks,
      dbgMgr,
      ctx.globalStorageUri.fsPath
    );
    const depSvc = new DeploymentService(singleton.configManager, pluginRegistry, singleton.bus, singleton.hooks);
    const logSvc = new LogService(pluginRegistry, singleton.configManager);
    
    singleton.logger.info('Modern services initialized successfully');
    
    // Initialize plugin server service
    const pluginInitResult = await pluginSrvSvc.initialize();
    if (!pluginInitResult.ok) {
      console.error('❌ JSM: Failed to initialize plugin server service:', pluginInitResult.error);
      window.showErrorMessage(`Java Server Manager: Failed to initialize: ${pluginInitResult.error.message}`);
      return;
    }

    const syncSvc = new AutoSyncService(depSvc);

    /* Register VSCode commands */
    registerServerCommands(ctx, srvSvc);
    registerDeploymentCommands(ctx, depSvc, syncSvc);
    registerTemplateCommands(ctx, pluginSrvSvc);

    /* Tree-view */
    const treeProv = new ServerTreeViewProvider(srvSvc, singleton.bus, singleton.logger);
    ctx.subscriptions.push(treeProv);
    
    // Register the tree view
    const treeView = window.createTreeView('javaServerManagerView', {
      treeDataProvider: treeProv,
      showCollapseAll: true
    });
    ctx.subscriptions.push(treeView);

    /* Load workspace servers using plugin service */
    const loadResult = await pluginSrvSvc.loadWorkspace();
    if (!loadResult.ok) {
      console.error('❌ JSM: Failed to load servers:', loadResult.error);
      window.showErrorMessage('JSM: unable to load servers configuration.');
    } else {
      console.log('✅ JSM: Servers loaded successfully');
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

    // Stop all running servers using runtime manager
    if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
      const runtimeManager = ServerRuntimeManager.getInstance();
      await runtimeManager.stopAllServers();
      await runtimeManager.dispose();
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

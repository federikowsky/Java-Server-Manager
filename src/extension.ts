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
import { FileUtils } from './core/utils/FileUtils';
import { TemplateManager } from './core/templates/TemplateManager';
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
import { ServerLogChannel } from './services/ServerLogChannel';

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
  configManager: null as ConfigManager | null,
  serverLogChannel: null as ServerLogChannel | null
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
    /* Initialize File System Utilities */
    singleton.logger.info('Initializing file system utilities...');
    FileUtils.initialize(ctx);

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

    /* Initialize Template Manager */
    singleton.logger.info('Initializing template management system...');
    const templateManager = TemplateManager.getInstance();
    const templateInitResult = await templateManager.initialize();
    if (!templateInitResult.ok) {
      singleton.logger.error('Failed to initialize template manager:', templateInitResult.error);
      window.showErrorMessage(`Template system initialization failed: ${templateInitResult.error.message}`);
      return;
    }
    
    singleton.logger.info(`Template system initialized successfully. Loaded ${templateManager.getAllTemplates().length} templates.`);

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
    
    const srvSvc = new ServerService(pidMgr, singleton.bus, singleton.hooks, dbgMgr);
    const depSvc = new DeploymentService(singleton.configManager, pluginRegistry, singleton.bus, singleton.hooks);
    
    // Initialize deployment state repository
    const depStateInitResult = await depSvc.initialize(workspace.workspaceFolders![0].uri.toString());
    if (!depStateInitResult.ok) {
      singleton.logger.error('Failed to initialize deployment state repository:', depStateInitResult.error);
      window.showErrorMessage(`Deployment state initialization failed: ${depStateInitResult.error.message}`);
      return;
    }
    
    singleton.logger.info('Modern services initialized successfully');

    const syncSvc = new AutoSyncService(depSvc);

    const serverLogChannel = new ServerLogChannel();
    singleton.serverLogChannel = serverLogChannel;

    // Wire per-server live log tailing to server state changes
    ctx.subscriptions.push(
      singleton.bus.on('ServerStateChanged', async ({ id, state }) => {
        if (state === 'running') {
          const configResult = await singleton.configManager!.getServer(id);
          if (configResult.ok) {
            // attach is not awaited — channel is created synchronously inside
            // before the first await so show() works immediately after
            serverLogChannel.attach(configResult.value);
            serverLogChannel.show(id);
          }
        } else if (state === 'stopped' || state === 'error') {
          serverLogChannel.detach(id);
        }
      }),
      singleton.bus.on('ServerDeleted', ({ id }) => {
        serverLogChannel.dispose(id);
      })
    );

    /* Register VSCode commands */
    registerServerCommands(ctx, srvSvc, depSvc, serverLogChannel);
    registerDeploymentCommands(ctx, depSvc, syncSvc);
    registerTemplateCommands(ctx, srvSvc);

    /* Tree-view */
    const treeProv = new ServerTreeViewProvider(srvSvc, depSvc, syncSvc, singleton.bus, singleton.logger);
    ctx.subscriptions.push(treeProv);
    
    // Register the tree view
    const treeView = window.createTreeView('javaServerManagerView', {
      treeDataProvider: treeProv,
      showCollapseAll: true
    });
    ctx.subscriptions.push(treeView);

    /* Load workspace servers using server service */
    const loadResult = await srvSvc.loadWorkspace();
    if (!loadResult.ok) {
      console.error('❌ JSM: Failed to load workspace servers:', loadResult.error);
      window.showErrorMessage('JSM: unable to load server configurations.');
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
    // Dispose per-server log channels
    if (singleton.serverLogChannel) {
      singleton.serverLogChannel.disposeAll();
      singleton.serverLogChannel = null;
    }

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

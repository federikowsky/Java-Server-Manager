/*
 * src/commands/index.ts
 * Clean command registration following KISS principles and new event-driven architecture
 */

import {
  ExtensionContext,
  commands,
  window,
  env,
  workspace,
  QuickPickItem,
  QuickPickItemKind,
  ThemeIcon
} from 'vscode';
import * as path from 'path';
import { ServerNode, DeploymentNode } from '../ui/views/ServerTreeViewProvider';
import { ServerService } from '../services/ServerService';
import { DeploymentService } from '../services/DeploymentService';
import { AutoSyncService } from '../services/AutoSyncService';
import { Logger } from '../core/utils/logger';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { Result, err, ok } from '../core/utils/result';
import { DeploymentConfig, ServerTemplate } from '../core/types/domain';
import { ServerFormPanel } from '../ui/webviews/ServerFormPanel';
import { DeploymentFormPanel } from '../ui/webviews/DeploymentFormPanel';
import { ServerLogChannel } from '../services/ServerLogChannel';
import { TemplateManager } from '../core/templates/TemplateManager';
import { PluginRegistry } from '../core/server/plugins/registry/PluginRegistry';
import { EventBus } from '../core/EventBus';

const log = Logger.getInstance().createChild('Commands');
const COMMAND_IDS = {
  REFRESH: 'jsm.view.refresh',
  ADD_SERVER: 'jsm.server.add',
  REMOVE_SERVER: 'jsm.server.remove',
  OPEN_LOGS: 'jsm.server.openLogs',
  SYNC_ALL: 'jsm.server.syncAllDeployments',
  FULL_REDEPLOY_ALL: 'jsm.server.fullRedeployAll',
  COPY_DIAGNOSTICS: 'jsm.diagnostics.copy',
  DEPLOYMENT_SYNC: 'jsm.deployment.sync',
  DEPLOYMENT_FULL_REDEPLOY: 'jsm.deployment.fullRedeploy',
  DEPLOYMENT_UNDEPLOY: 'jsm.deployment.undeploy'
} as const;
// ==================== UTILITIES ====================

function showErr(e: unknown): void {
  const message = e instanceof JsmError ? e.message : 'Unexpected error occurred';
  log.error('Command error:', e);
  window.showErrorMessage(`JSM: ${message}`);
}

function showSuccess(message: string): void {
  log.info(message);
  window.showInformationMessage(`JSM: ${message}`);
}

function showInfo(message: string): void {
  log.info(message);
  window.showInformationMessage(`JSM: ${message}`);
}

function validateServerNode(node: ServerNode): string | null {
  if (!node?.data?.id) {
    showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
    return null;
  }
  return node.data.id;
}

function validateDeploymentNode(node: DeploymentNode): { serverId: string; deploymentId: string } | null {
  const serverId = node?.parent?.id;
  const deploymentId = node?.data?.id;
  
  if (!serverId || !deploymentId) {
    showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No deployment selected'));
    return null;
  }
  
  return { serverId, deploymentId };
}

function getPrimaryWorkspaceFolder(): string | null {
  return workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

async function copyDiagnostics(serverService: ServerService, serverId?: string): Promise<void> {
  const allServersResult = await serverService.getAllServers();
  if (!allServersResult.ok) {
    throw allServersResult.error;
  }

  const allServers = allServersResult.value;
  const selectedServer = serverId ? allServers.find((server) => server.id === serverId) : undefined;
  const selectedState = serverId ? serverService.getServerState(serverId) : undefined;

  const diagnostics = [
    'Java Server Manager Diagnostics',
    `Generated: ${new Date().toISOString()}`,
    `Workspace: ${getPrimaryWorkspaceFolder() ?? 'unavailable'}`,
    `Configured servers: ${allServers.length}`,
    selectedServer ? `Server: ${selectedServer.name} (${selectedServer.id})` : 'Server: all',
    selectedServer ? `Host: ${selectedServer.host}:${selectedServer.port}` : undefined,
    selectedServer ? `Home: ${selectedServer.serverHome}` : undefined,
    selectedServer ? `Deployments: ${selectedServer.deployments.length}` : undefined,
    selectedState?.ok ? `State: ${selectedState.value}` : undefined
  ].filter(Boolean).join('\n');

  await env.clipboard.writeText(diagnostics);
}

function registerMany(ctx: ExtensionContext, ids: readonly string[], handler: (...args: any[]) => unknown): void {
  for (const id of ids) {
    ctx.subscriptions.push(commands.registerCommand(id, handler));
  }
}

async function publishServerDeployments(
  dep: DeploymentService,
  serverId: string,
  deployments: DeploymentConfig[],
  mode: 'full' | 'incremental'
): Promise<Result<void, JsmError>> {
  const failures: string[] = [];

  for (const deployment of deployments) {
    const deploymentId = deployment.id;
    if (!deploymentId) {
      failures.push(`${deployment.deployName || deployment.sourcePath}: missing deployment id`);
      continue;
    }

    const result = await dep.publish(serverId, deploymentId, mode);
    if (!result.ok) {
      failures.push(`${deployment.deployName || deployment.sourcePath}: ${result.error.message}`);
    }
  }

  if (failures.length > 0) {
    return err(new JsmError(ErrorCode.DEPLOY_ERROR, failures.join('\n')));
  }

  return ok(undefined);
}

// ==================== SERVER COMMANDS ====================

export function registerServerCommands(
  ctx: ExtensionContext,
  srv: ServerService,
  dep: DeploymentService,
  serverLogChannel?: ServerLogChannel
) {
  registerMany(ctx, [COMMAND_IDS.ADD_SERVER], async () => {
    try {
      await showAddServerMenu(srv);
    } catch (error) {
      showErr(error);
    }
  });

  ctx.subscriptions.push(
    commands.registerCommand('jsm.server.startRun', async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        const result = await srv.start(serverId, 'run');
        if (result.ok) {
          showSuccess('Server started in run mode');
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.server.startDebug', async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        const result = await srv.start(serverId, 'debug');
        if (result.ok) {
          showSuccess('Server started in debug mode');
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.server.stop', async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        const result = await srv.stop(serverId);
        if (result.ok) {
          showSuccess('Server stopped');
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.server.restartRun', async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        const result = await srv.restart(serverId, 'run');
        if (result.ok) {
          showSuccess('Server restarted in run mode');
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.server.restartDebug', async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        const result = await srv.restart(serverId, 'debug');
        if (result.ok) {
          showSuccess('Server restarted in debug mode');
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.server.edit', async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        const serverResult = await srv.getServer(serverId);
        if (!serverResult.ok) {
          showErr(serverResult.error);
          return;
        }

        const panelResult = await ServerFormPanel.showForm(serverId);

        if (!panelResult.ok) return;

        const updateResult = await srv.updateFromUserInput(serverId, panelResult.value);
        if (updateResult.ok) {
          showSuccess(`Server "${updateResult.value.name}" updated successfully!`);
          await commands.executeCommand(COMMAND_IDS.REFRESH);
        } else {
          showErr(updateResult.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand(COMMAND_IDS.REMOVE_SERVER, async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        const serverName = node.data.name || serverId;
        const confirmation = await window.showWarningMessage(
          `Are you sure you want to delete server "${serverName}"?`,
          { modal: true },
          'Delete Server'
        );

        if (confirmation === 'Delete Server') {
          const result = await srv.delete(serverId);
          if (result.ok) {
            showSuccess(`Server "${serverName}" deleted successfully`);
            await commands.executeCommand(COMMAND_IDS.REFRESH);
          } else {
            showErr(result.error);
          }
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand(COMMAND_IDS.SYNC_ALL, async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        // Get all deployments for this server and redeploy them incrementally
        const serverResult = await srv.getServer(serverId);
        if (!serverResult.ok) {
          showErr(serverResult.error);
          return;
        }

        const deployments = serverResult.value.deployments;
        if (deployments.length === 0) {
          showInfo('No deployments found for this server');
          return;
        }

        showInfo(`Deploying ${deployments.length} deployment(s) incrementally...`);
        const publishResult = await publishServerDeployments(dep, serverId, deployments, 'incremental');
        if (!publishResult.ok) {
          showErr(publishResult.error);
          return;
        }

        await commands.executeCommand(COMMAND_IDS.REFRESH);
        showSuccess('Incremental deployment completed');
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand(COMMAND_IDS.FULL_REDEPLOY_ALL, async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        const serverResult = await srv.getServer(serverId);
        if (!serverResult.ok) {
          showErr(serverResult.error);
          return;
        }

        const deployments = serverResult.value.deployments;
        if (deployments.length === 0) {
          showInfo('No deployments found for this server');
          return;
        }

        const confirmation = await window.showWarningMessage(
          `This will completely redeploy all ${deployments.length} deployment(s). Continue?`,
          { modal: true },
          'Full Redeploy'
        );

        if (confirmation === 'Full Redeploy') {
          showInfo(`Starting full redeploy of ${deployments.length} deployment(s)...`);
          const publishResult = await publishServerDeployments(dep, serverId, deployments, 'full');
          if (!publishResult.ok) {
            showErr(publishResult.error);
            return;
          }

          await commands.executeCommand(COMMAND_IDS.REFRESH);
          showSuccess('Full redeploy completed');
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand(COMMAND_IDS.OPEN_LOGS, async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        if (!serverLogChannel) {
          showErr(new JsmError(ErrorCode.PLUGIN_ERROR, 'Log channel not available'));
          return;
        }

        const shown = serverLogChannel.show(serverId);
        if (!shown) {
          showInfo('Start the server to see live logs');
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand(COMMAND_IDS.REFRESH, async () => {
      try {
        const result = await srv.getAllServers();
        if (result.ok) {
          EventBus.getInstance().emit('ConfigChanged', { source: 'api', servers: result.value });
          showInfo(`Refreshed: ${result.value.length} servers loaded`);
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand(COMMAND_IDS.COPY_DIAGNOSTICS, async (node?: ServerNode) => {
      try {
        await copyDiagnostics(srv, node?.data?.id);
        showSuccess('Diagnostics copied to clipboard');
      } catch (error) {
        showErr(error);
      }
    })
  );
}

export function registerDeploymentCommands(
  ctx: ExtensionContext,
  dep: DeploymentService,
  sync: AutoSyncService
) {
  ctx.subscriptions.push(
    commands.registerCommand('jsm.deployment.add', async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        // Show deployment form panel
        const panelResult = await DeploymentFormPanel.showForm(serverId);

        if (!panelResult.ok) {
          // User cancelled
          return;
        }

        // Create deployment with configuration from DeploymentFormPanel
        const createResult = await dep.add(serverId, panelResult.value);
        if (createResult.ok) {
          showSuccess(`Deployment "${panelResult.value.deployName || 'New Deployment'}" created successfully!`);
          
          // Refresh the tree view to show the new deployment
          await commands.executeCommand(COMMAND_IDS.REFRESH);
        } else {
          showErr(createResult.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.deployment.edit', async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        // Show deployment form panel with existing data
        const panelResult = await DeploymentFormPanel.showForm(nodeData.serverId, nodeData.deploymentId);

        if (!panelResult.ok) {
          // User cancelled
          return;
        }

        // Update deployment configuration through ConfigManager
        const { ConfigManager } = await import('../core/config/ConfigManager');
        const configManager = ConfigManager.getInstance();
        const updateResult = await configManager.updateDeployment(nodeData.serverId, nodeData.deploymentId, panelResult.value);
        if (updateResult.ok) {
          showSuccess(`Deployment "${panelResult.value.deployName || 'Deployment'}" updated successfully!`);
          
          // Refresh the tree view to show changes
          await commands.executeCommand(COMMAND_IDS.REFRESH);
        } else {
          showErr(updateResult.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.deployment.remove', async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        const deploymentName = node.data.deployName || node.data.sourcePath.split('/').pop()?.replace('.war', '') || nodeData.deploymentId;
        const confirmation = await window.showWarningMessage(
          `Remove deployment "${deploymentName}" and its files?`,
          { modal: true },
          'Remove Deployment'
        );

        if (confirmation === 'Remove Deployment') {
          const result = await dep.remove(nodeData.serverId, nodeData.deploymentId, true);
          if (result.ok) {
            showSuccess(`Deployment "${deploymentName}" removed successfully`);
            await commands.executeCommand(COMMAND_IDS.REFRESH);
          } else {
            showErr(result.error);
          }
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand(COMMAND_IDS.DEPLOYMENT_SYNC, async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        const result = await dep.publish(nodeData.serverId, nodeData.deploymentId);
        if (result.ok) {
          showSuccess('Deployment published successfully');
          await commands.executeCommand(COMMAND_IDS.REFRESH);
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand(COMMAND_IDS.DEPLOYMENT_UNDEPLOY, async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        const result = await dep.undeploy(nodeData.serverId, nodeData.deploymentId);
        if (result.ok) {
          showSuccess('Deployment undeployed successfully');
          await commands.executeCommand(COMMAND_IDS.REFRESH);
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.deployment.toggleAutosync', async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        const result = await sync.toggle(nodeData.serverId, nodeData.deploymentId);
        if (result.ok) {
          const status = result.value === 'enabled' ? 'enabled' : 'disabled';
          showSuccess(`AutoSync ${status} for deployment`);
          await commands.executeCommand(COMMAND_IDS.REFRESH);
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand(COMMAND_IDS.DEPLOYMENT_FULL_REDEPLOY, async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        const result = await dep.publish(nodeData.serverId, nodeData.deploymentId, 'full');
        if (result.ok) {
          showSuccess('Deployment fully redeployed successfully');
          await commands.executeCommand(COMMAND_IDS.REFRESH);
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

  );
}

/* ───────────────────────── Template commands ────────────────────── */
export function registerTemplateCommands(ctx: ExtensionContext, srv: ServerService) {
  ctx.subscriptions.push(
    // Manage Templates - Main entry point
    commands.registerCommand('jsm.templates.manage', async () => {
      try {
        await showTemplateManagementMenu(srv);
      } catch (error) {
        showErr(error);
      }
    }),

    // Add Server from Template - Enhanced workflow  
    commands.registerCommand('jsm.server.addFromTemplate', async () => {
      try {
        await showAddServerFromTemplateMenu(srv);
      } catch (error) {
        showErr(error);
      }
    })
  );
}

/**
 * Show Add Server menu with available templates or placeholder
 */
async function showAddServerMenu(service: ServerService): Promise<void> {
  const templateManager = TemplateManager.getInstance();
  const allTemplates = templateManager.getAllTemplates();
  
  if (allTemplates.length === 0) {
    // No templates available - show information and redirect to template management
    const addTemplate = await window.showInformationMessage(
      'No server templates available. Register a template first to create server instances.',
      'Manage Templates',
      'Cancel'
    );
    
    if (addTemplate === 'Manage Templates') {
      await showTemplateManagementMenu(service);
    }
    return;
  }

  // Show available templates only
  const items: QuickPickItem[] = await Promise.all(allTemplates.map(async (template: ServerTemplate) => {
    // Detect server type from template's default config
    const serverHome = template.defaultConfig.serverHome;
    let detectedType = 'Unknown';
    if (serverHome) {
      const result = await PluginRegistry.getInstance().detectServerType(serverHome);
      detectedType = result.ok ? result.value : 'Unknown';
    }
    return {
      label: template.name,
      description: detectedType,
      detail: `Create instance from: ${serverHome || 'Unknown'}`,
      iconPath: new ThemeIcon('server')
    };
  }));

  // Always offer a path to template management at the bottom
  items.push({ label: '', kind: QuickPickItemKind.Separator });
  items.push({
    label: '$(settings-gear) Manage Templates',
    description: 'Add, remove, or view registered templates'
  });

  const selection = await window.showQuickPick(items, {
    title: 'Add Server from Template',
    placeHolder: 'Select a template to create server instance',
    matchOnDescription: true
  });

  if (!selection) return;

  if (selection.label.includes('Manage Templates')) {
    await showTemplateManagementMenu(service);
    return;
  }

  // Find selected template and create instance
  const template = allTemplates.find((t: ServerTemplate) => t.name === selection.label);
  if (template) {
    await createInstanceFromTemplate(service, template);
  }
}

/* ───────────────────────── Template Management Implementation ────────────────────── */

/**
 * Show template management QuickPick with existing templates + "Add New Template" option
 */
async function showTemplateManagementMenu(service: ServerService): Promise<void> {
  const templateManager = TemplateManager.getInstance();
  const allTemplates = templateManager.getAllTemplates();
  const items: QuickPickItem[] = [];

  // Add existing templates first
  if (allTemplates.length > 0) {
    for (const template of allTemplates) {
      // Detect server type from template's default config  
      const serverHome = template.defaultConfig.serverHome;
      let detectedType = 'Unknown';
      if (serverHome) {
        const result = await PluginRegistry.getInstance().detectServerType(serverHome);
        detectedType = result.ok ? result.value : 'Unknown';
      }
      items.push({
        label: template.name,
        description: detectedType,
        detail: template.description || 'No description',
        iconPath: new ThemeIcon('server')
      });
    }

    // Add separator before "Add New Template"
    items.push({ label: '', kind: QuickPickItemKind.Separator });
  }

  // Add "Add New Template" option at the bottom
  items.push({
    label: '$(plus) Add New Template',
    description: 'Register a new server template',
    detail: 'Browse for a server installation directory'
  });

  const selection = await window.showQuickPick(items, {
    title: 'Manage Server Templates',
    placeHolder: allTemplates.length > 0 
      ? 'Select a template to manage or add a new one'
      : 'No templates available. Add first',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!selection) return;

  if (selection.label.includes('Add New Template')) {
    await showAddTemplateWorkflow(service);
  } else {
    // Find the selected template by name
    const template = allTemplates.find((t: ServerTemplate) => t.name === selection.label);
    if (template) {
      await showTemplateActions(service, template);
    }
  }
}

/**
 * Show actions for a specific template (rename, delete, etc.)
 */
async function showTemplateActions(service: ServerService, template: ServerTemplate): Promise<void> {
  const actions: QuickPickItem[] = [
    {
      label: '$(edit) Rename Template',
      description: 'Change template display name',
      detail: `Current name: ${template.name}`
    },
    {
      label: '$(trash) Delete Template',
      description: 'Remove template permanently',
      detail: '⚠️ This action cannot be undone'
    }
  ];

  const action = await window.showQuickPick(actions, {
    title: `Manage Template: ${template.name}`,
    placeHolder: 'Select an action'
  });

  if (!action) return;

  if (action.label.includes('Rename')) {
    await renameTemplate(service, template);
  } else if (action.label.includes('Delete')) {
    await deleteTemplate(service, template);
  }
}

/**
 * Add New Template workflow: File picker → Silent registration
 */
async function showAddTemplateWorkflow(service: ServerService): Promise<void> {
  const templateManager = TemplateManager.getInstance();
  
  // Step 1: File picker for server directory
  const folderUris = await window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select Server Directory',
    title: 'Select Server Installation Directory'
  });

  if (!folderUris || folderUris.length === 0) return;

  const serverPath = folderUris[0].fsPath;
  const folderName = path.basename(serverPath);

  // Step 2: Auto-detect server type
  const detectionResult = await service.detectServerType(serverPath);
  if (!detectionResult.ok) {
    showErr(new JsmError(ErrorCode.CONFIG_INVALID, `Cannot detect server type from path: ${serverPath}`));
    return;
  }

  const serverType = detectionResult.value;

  // Step 3: Input template name
  const templateName = await window.showInputBox({
    title: 'Template Name',
    prompt: 'Enter template name',
    value: `${folderName}`,
    validateInput: (value) => {
      if (!value?.trim()) return 'Template name required';
      if (value.trim().length > 100) return 'Name too long (max 100 chars)';
      if (templateManager.getAllTemplates().some((t: ServerTemplate) => t.name === value.trim())) {
        return 'Template name already exists';
      }
      return undefined;
    }
  });

  if (!templateName) return;

  // Step 4: Get default config and create template
  const defaultConfigResult = await service.getDefaultConfig(serverType);
  if (!defaultConfigResult.ok) {
    showErr(defaultConfigResult.error);
    return;
  }

  const template: ServerTemplate = {
    id: `template_${Date.now()}`,
    name: templateName.trim(),
    defaultConfig: {
      ...defaultConfigResult.value,
      serverHome: serverPath,
      javaHome: process.env.JAVA_HOME || '',
      host: 'localhost',
      port: serverType === 'tomcat' ? 8080 : 8081,
      autoSync: false
    },
    description: `${serverType} template from ${serverPath}`
  };

  // Register template with TemplateManager
  const addResult = await templateManager.addTemplate(template);
  if (addResult.ok) {
    showSuccess(`Template "${templateName}" registered successfully!`);
  } else {
    showErr(addResult.error);
  }
}

/**
 * Show Add Server menu with templates or explanation
 */
async function showAddServerFromTemplateMenu(service: ServerService): Promise<void> {
  const templateManager = TemplateManager.getInstance();
  const allTemplates = templateManager.getAllTemplates();
  
  if (allTemplates.length === 0) {
    // No templates available - show explanation and redirect to template management
    const addTemplate = await window.showInformationMessage(
      'No server templates available. You need to register a server template first before creating server instances.',
      'Add Template',
      'Cancel'
    );
    
    if (addTemplate === 'Add Template') {
      await showAddTemplateWorkflow(service);
    }
    return;
  }

  // Show available templates
  const items: QuickPickItem[] = await Promise.all(allTemplates.map(async (template: ServerTemplate) => {
    // Detect server type from template's default config
    const serverHome = template.defaultConfig.serverHome;
    let detectedType = 'Unknown';
    if (serverHome) {
      const result = await PluginRegistry.getInstance().detectServerType(serverHome);
      detectedType = result.ok ? result.value : 'Unknown';
    }
    return {
      label: template.name,
      description: detectedType,
      detail: `Create instance from: ${serverHome || 'Unknown'}`,
      iconPath: new ThemeIcon('server')
    };
  }));

  const selection = await window.showQuickPick(items, {
    title: 'Create Server Instance',
    placeHolder: 'Select a template to create a server instance from',
    matchOnDescription: true
  });

  if (!selection) return;

  // Find the selected template by name
  const template = allTemplates.find((t: ServerTemplate) => t.name === selection.label);
  
  if (template) {
    await createInstanceFromTemplate(service, template);
  }
}

/**
 * Create server instance from template using ServerFormPanel
 */
async function createInstanceFromTemplate(service: ServerService, template: ServerTemplate): Promise<void> {
  // Show form with template data pre-populated
  const panelResult = await ServerFormPanel.showForm();

  if (!panelResult.ok) {
    // User cancelled
    return;
  }

  // Create server with configuration from ServerFormPanel
  const createResult = await service.createFromUserInput(panelResult.value);
  if (createResult.ok) {
    showSuccess(`Server instance "${createResult.value.name}" created successfully!`);
    
    // Refresh the tree view to show the new server
    await commands.executeCommand(COMMAND_IDS.REFRESH);
  } else {
    showErr(createResult.error);
  }
}

/**
 * Rename template workflow
 */
async function renameTemplate(service: ServerService, template: ServerTemplate): Promise<void> {
  const templateManager = TemplateManager.getInstance();
  
  const newName = await window.showInputBox({
    title: 'Rename Template',
    prompt: 'Enter new template name',
    value: template.name,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Template name is required';
      }
      if (value.trim().length > 100) {
        return 'Template name too long (max 100 characters)';
      }
      // Check for duplicate names (excluding current template)
      if (templateManager.getAllTemplates().some((t: ServerTemplate) => t.name === value.trim() && t.id !== template.id)) {
        return 'Template name already exists';
      }
      return undefined;
    }
  });

  if (!newName || newName.trim() === template.name) return;

  // Update template name
  const updatedTemplate = { ...template, name: newName.trim() };
  const updateResult = await templateManager.updateTemplate(updatedTemplate);
  
  if (updateResult.ok) {
    showSuccess(`Template renamed to "${newName.trim()}" successfully`);
  } else {
    showErr(updateResult.error);
  }
}

/**
 * Delete template with confirmation
 */
async function deleteTemplate(service: ServerService, template: ServerTemplate): Promise<void> {
  const confirmation = await window.showWarningMessage(
    `⚠️ Delete template "${template.name}"?\n\nThis will permanently remove the template but keep the original server files intact.`,
    { modal: true },
    'Delete Template'
  );

  if (confirmation !== 'Delete Template') return;

  // Delete template using TemplateManager
  const templateManager = TemplateManager.getInstance();
  const deleteResult = await templateManager.deleteTemplate(template.id);
  
  if (deleteResult.ok) {
    showSuccess(`Template "${template.name}" deleted successfully`);
  } else {
    showErr(deleteResult.error);
  }
}
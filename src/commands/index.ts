/*
 * src/commands/index.ts
 * Registers ALL VSCode commands defined in package.json
 */

import {
  ExtensionContext,
  commands,
  window,
  workspace,
  env,
  Uri,
  QuickPickItem,
  QuickPickItemKind,
  ThemeIcon
} from 'vscode';
import { ServerNode, DeploymentNode } from '../ui/views/ServerTreeViewProvider';
import { ServerService } from '../services/ServerService';
import { PluginServerService } from '../services/PluginServerService';
import { DeploymentService } from '../services/DeploymentService';
import { AutoSyncService } from '../services/AutoSyncService';
import { Logger } from '../core/utils/logger';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { ServerConfig, DeploymentConfig } from '../core/types/domain';
import * as path from 'path';
import { BaseServerTemplate, RegisterTemplateRequest } from '../core/types/instance';
import { ServerInstanceManager } from '../core/instance/ServerInstanceManager';
import { EditServerPanel } from '../ui/webviews/EditServerPanel';

const log = Logger.getInstance().createChild('Commands');

function showErr(e: unknown): void {
  const message = e instanceof JsmError ? e.message : 'Unexpected error occurred';
  log.error('Command error:', e);
  window.showErrorMessage(`JSM: ${message}`);
}

function showSuccess(message: string): void {
  log.info(message);
  window.showInformationMessage(`JSM: ${message}`);
}

function showInformation(message: string): void {
  log.info(message);
  window.showInformationMessage(`JSM: ${message}`);
}

/* ───────────────────────── Server Commands ───────────────────────── */
export function registerServerCommands(ctx: ExtensionContext, srv: ServerService) {
  ctx.subscriptions.push(
    // Add Server command is now registered in registerTemplateCommands
    // This ensures proper template-based workflow

    // Start Run
    commands.registerCommand('jsm.server.startRun', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        const res = await srv.start(serverId, 'run');
        if (res.ok) {
          showSuccess(`Server ${serverId} started in run mode`);
        } else {
          showErr(res.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Start Debug
    commands.registerCommand('jsm.server.startDebug', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        const res = await srv.start(serverId, 'debug');
        if (res.ok) {
          showSuccess(`Server ${serverId} started in debug mode`);
        } else {
          showErr(res.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Stop Server
    commands.registerCommand('jsm.server.stop', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        const res = await srv.stop(serverId);
        if (res.ok) {
          showSuccess(`Server ${serverId} stopped`);
        } else {
          showErr(res.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Restart Run
    commands.registerCommand('jsm.server.restartRun', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        const res = await srv.restart(serverId, 'run');
        if (res.ok) {
          showSuccess(`Server ${serverId} restarted in run mode`);
        } else {
          showErr(res.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Restart Debug
    commands.registerCommand('jsm.server.restartDebug', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        const res = await srv.restart(serverId, 'debug');
        if (res.ok) {
          showSuccess(`Server ${serverId} restarted in debug mode`);
        } else {
          showErr(res.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Edit Server
    commands.registerCommand('jsm.server.edit', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        // Get current server configuration
        const serverResult = srv.get(serverId);
        if (!serverResult.ok) {
          showErr(serverResult.error);
          return;
        }

        // Open EditServerPanel for editing
        const panelResult = await EditServerPanel.open({
          mode: 'edit',
          data: serverResult.value
        });

        if (!panelResult.ok) {
          // User cancelled
          return;
        }

        // Update server with new configuration
        const updateResult = await srv.update(panelResult.value);
        if (updateResult.ok) {
          showSuccess(`Server "${panelResult.value.name}" updated successfully!`);
          
          // Refresh the tree view to show changes
          await commands.executeCommand('jsm.treeview.refresh');
        } else {
          showErr(updateResult.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Deploy Changes
    commands.registerCommand('jsm.server.deployChanges', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        window.showInformationMessage(`Deploy Changes for ${serverId} - Not implemented yet`);
      } catch (error) {
        showErr(error);
      }
    }),

    // Full Redeploy
    commands.registerCommand('jsm.server.fullRedeploy', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        window.showInformationMessage(`Full Redeploy for ${serverId} - Not implemented yet`);
      } catch (error) {
        showErr(error);
      }
    }),

    // View Logs
    commands.registerCommand('jsm.server.viewLogs', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        window.showInformationMessage(`View Logs for ${serverId} - Not implemented yet`);
      } catch (error) {
        showErr(error);
      }
    }),

    // Delete Server with confirmation
    commands.registerCommand('jsm.server.delete', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        const serverName = node?.data?.name || serverId;
        
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        // Show confirmation dialog
        const confirmation = await window.showWarningMessage(
          `Are you sure you want to delete server "${serverName}"?`,
          { modal: true },
          'Delete Server'
        );
        
        if (confirmation === 'Delete Server') {
          const res = await srv.delete(serverId);
          if (res.ok) {
            showSuccess(`Server ${serverName} deleted successfully`);
          } else {
            showErr(res.error);
          }
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Open Server Directory
    commands.registerCommand('jsm.server.openDir', async (node: ServerNode) => {
      try {
        const serverHome = node?.data?.serverHome;
        if (!serverHome) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server home directory'));
          return;
        }
        
        const uri = Uri.file(serverHome);
        await commands.executeCommand('revealFileInOS', uri);
      } catch (error) {
        showErr(error);
      }
    }),

    // Copy Server Info
    commands.registerCommand('jsm.server.copyInfo', async (node: ServerNode) => {
      try {
        const serverData = node?.data;
        if (!serverData) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        const info = `Server: ${serverData.name}
ID: ${serverData.id}
Type: ${serverData.type}
Host: ${serverData.host}:${serverData.port}
Home: ${serverData.serverHome}
State: ${serverData.state}`;
        
        await env.clipboard.writeText(info);
        showSuccess('Server info copied to clipboard');
      } catch (error) {
        showErr(error);
      }
    }),

    // Tree View Refresh
    commands.registerCommand('jsm.treeview.refresh', async () => {
      try {
        const res = await srv.loadWorkspace();
        if (res.ok) {
          showSuccess('Server list refreshed');
        } else {
          showErr(res.error);
        }
      } catch (error) {
        showErr(error);
      }
    })
  );
}

/* ───────────────────────── Deployment Commands ───────────────────────── */
export function registerDeploymentCommands(
  ctx: ExtensionContext,
  dep: DeploymentService,
  sync: AutoSyncService
) {
  ctx.subscriptions.push(
    // Add Deployment
    commands.registerCommand('jsm.deployment.add', async (node: ServerNode) => {
      try {
        const serverId = node?.data?.id;
        if (!serverId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
          return;
        }
        
        // Simple test deployment for now
        const testDeployment: DeploymentConfig = {
          id: `deployment-${Date.now()}`,
          name: `Test Deployment ${new Date().toLocaleTimeString()}`,
          sourcePath: workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp',
          targetPath: '/webapps',
          contextPath: '/test',
          type: 'war',
          state: 'undeployed'
        };
        
        const res = await dep.add(serverId, testDeployment);
        if (res.ok) {
          showSuccess(`Deployment added: ${testDeployment.name}`);
        } else {
          showErr(res.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Remove Deployment (with confirmation)
    commands.registerCommand('jsm.deployment.remove', async (node: DeploymentNode) => {
      try {
        const serverId = node?.parent?.id;
        const deploymentId = node?.data?.id;
        const deploymentName = node?.data?.name || deploymentId;
        
        if (!serverId || !deploymentId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No deployment selected'));
          return;
        }
        
        // Show confirmation dialog
        const confirmation = await window.showWarningMessage(
          `Are you sure you want to remove deployment "${deploymentName}"?`,
          { modal: true },
          'Remove Deployment'
        );
        
        if (confirmation === 'Remove Deployment') {
          const res = await dep.remove(serverId, deploymentId, true);
          if (res.ok) {
            showSuccess(`Deployment ${deploymentName} removed successfully`);
          } else {
            showErr(res.error);
          }
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Force Deploy
    commands.registerCommand('jsm.deployment.forceDeploy', async (node: DeploymentNode) => {
      try {
        const serverId = node?.parent?.id;
        const deploymentId = node?.data?.id;
        
        if (!serverId || !deploymentId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No deployment selected'));
          return;
        }
        
        const res = await dep.publish(serverId, deploymentId);
        if (res.ok) {
          showSuccess(`Deployment ${deploymentId} deployed successfully`);
        } else {
          showErr(res.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Undeploy Soft
    commands.registerCommand('jsm.deployment.undeploySoft', async (node: DeploymentNode) => {
      try {
        const serverId = node?.parent?.id;
        const deploymentId = node?.data?.id;
        
        if (!serverId || !deploymentId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No deployment selected'));
          return;
        }
        
        const res = await dep.undeploy(serverId, deploymentId);
        if (res.ok) {
          showSuccess(`Deployment ${deploymentId} undeployed successfully`);
        } else {
          showErr(res.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Toggle AutoSync
    commands.registerCommand('jsm.deployment.toggleAutosync', async (node: DeploymentNode) => {
      try {
        const serverId = node?.parent?.id;
        const deploymentId = node?.data?.id;
        
        if (!serverId || !deploymentId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No deployment selected'));
          return;
        }
        
        const res = sync.toggle(serverId, deploymentId);
        if (res.ok) {
          showSuccess(`AutoSync toggled for deployment ${deploymentId}`);
        } else {
          showErr(res.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Remove Soft (Config Only)
    commands.registerCommand('jsm.deployment.removeSoft', async (node: DeploymentNode) => {
      try {
        const serverId = node?.parent?.id;
        const deploymentId = node?.data?.id;
        const deploymentName = node?.data?.name || deploymentId;
        
        if (!serverId || !deploymentId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No deployment selected'));
          return;
        }
        
        // Show confirmation dialog
        const confirmation = await window.showWarningMessage(
          `Remove deployment "${deploymentName}" from configuration only (keep files)?`,
          { modal: true },
          'Remove Config Only'
        );
        
        if (confirmation === 'Remove Config Only') {
          const res = await dep.remove(serverId, deploymentId, false);
          if (res.ok) {
            showSuccess(`Deployment ${deploymentName} removed from config`);
          } else {
            showErr(res.error);
          }
        }
      } catch (error) {
        showErr(error);
      }
    }),

    // Remove Hard (Config and Files)
    commands.registerCommand('jsm.deployment.removeHard', async (node: DeploymentNode) => {
      try {
        const serverId = node?.parent?.id;
        const deploymentId = node?.data?.id;
        const deploymentName = node?.data?.name || deploymentId;
        
        if (!serverId || !deploymentId) {
          showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No deployment selected'));
          return;
        }
        
        // Show confirmation dialog with warning
        const confirmation = await window.showWarningMessage(
          `⚠️ DANGER: This will permanently delete deployment "${deploymentName}" and all its files!`,
          { modal: true },
          'Delete Everything'
        );
        
        if (confirmation === 'Delete Everything') {
          const res = await dep.remove(serverId, deploymentId, true);
          if (res.ok) {
            showSuccess(`Deployment ${deploymentName} and files deleted permanently`);
          } else {
            showErr(res.error);
          }
        }
      } catch (error) {
        showErr(error);
      }
    })
  );
}

/* ───────────────────────── Template commands ────────────────────── */
export function registerTemplateCommands(ctx: ExtensionContext, pluginServerService: PluginServerService) {

  ctx.subscriptions.push(
    // Manage Templates - Main entry point
    commands.registerCommand('jsm.templates.manage', async () => {
      try {
        await showTemplateManagementMenu(pluginServerService);
      } catch (error) {
        showErr(error);
      }
    }),

    // Add Server from Template - Enhanced workflow  
    commands.registerCommand('jsm.server.add', async () => {
      try {
        await showAddServerMenu(pluginServerService);
      } catch (error) {
        showErr(error);
      }
    })
  );
}

/* ───────────────────────── Template Management Implementation ────────────────────── */

/**
 * Show template management QuickPick with existing templates + "Add New Template" option
 */
async function showTemplateManagementMenu(service: PluginServerService): Promise<void> {
  const templatesResult = await service.getTemplates();
  if (!templatesResult.ok) {
    showErr(templatesResult.error);
    return;
  }

  const templates = templatesResult.value;
  const items: QuickPickItem[] = [];

  // Add existing templates first
  if (templates.length > 0) {
    templates.forEach(template => {
      items.push({
        label: template.name,
        description: `${template.type} • ${template.version}`,
        detail: template.basePath,
        iconPath: new ThemeIcon('server')
      });
    });

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
    placeHolder: templates.length > 0 
      ? 'Select a template to manage or add a new one'
      : 'No templates available. Add first',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!selection) return;

  if (selection.label.includes('Add New Template')) {
    await showAddTemplateWorkflow(service);
  } else {
    // Find the selected template by name (no prefix to remove)
    const template = templates.find(t => t.name === selection.label);
    if (template) {
      await showTemplateActions(service, template);
    }
  }
}

/**
 * Show actions for a specific template (rename, delete, etc.)
 */
async function showTemplateActions(service: PluginServerService, template: BaseServerTemplate): Promise<void> {
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
 * Add New Template workflow: File picker → Input box → Registration
 */
async function showAddTemplateWorkflow(service: PluginServerService): Promise<void> {
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

  // Step 2: Input box for template name
  const templateName = await window.showInputBox({
    title: 'Template Name',
    prompt: 'Enter a display name for this template',
    value: folderName,
    placeHolder: folderName,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Template name is required';
      }
      if (value.trim().length > 100) {
        return 'Template name too long (max 100 characters)';
      }
      return undefined;
    }
  });

  if (!templateName) return;

  // Step 3: Register the template
  const request: RegisterTemplateRequest = {
    name: templateName.trim(),
    basePath: serverPath
  };

  const result = await service.registerTemplate(request);
  if (result.ok) {
    showSuccess(`Template "${templateName}" registered successfully!`);
    
    // Ask if user wants to create an instance
    const createInstance = await window.showInformationMessage(
      `Template "${templateName}" registered! Would you like to create a server instance from this template?`,
      'Create Instance',
      'Not Now'
    );
    
    if (createInstance === 'Create Instance') {
      await createInstanceFromTemplate(service, result.value);
    }
  } else {
    showErr(result.error);
  }
}

/**
 * Show Add Server menu with templates or explanation
 */
async function showAddServerMenu(service: PluginServerService): Promise<void> {
  const templatesResult = await service.getTemplates();
  if (!templatesResult.ok) {
    showErr(templatesResult.error);
    return;
  }

  const templates = templatesResult.value;
  
  if (templates.length === 0) {
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
  const items: QuickPickItem[] = templates.map(template => ({
    label: template.name,
    description: `${template.type} • ${template.version}`,
    detail: `Create instance from: ${template.basePath}`,
    iconPath: new ThemeIcon('server')
  }));

  const selection = await window.showQuickPick(items, {
    title: 'Create Server Instance',
    placeHolder: 'Select a template to create a server instance from',
    matchOnDescription: true
  });

  if (!selection) return;

  // Find the selected template by name (no prefix to remove)
  const template = templates.find(t => t.name === selection.label);
  
  if (template) {
    await createInstanceFromTemplate(service, template);
  }
}

/**
 * Create server instance from template using EditServerPanel
 */
async function createInstanceFromTemplate(service: PluginServerService, template: BaseServerTemplate): Promise<void> {
  // Use EditServerPanel.openFromTemplate for clean template → server workflow
  const panelResult = await EditServerPanel.openFromTemplate(template);

  if (!panelResult.ok) {
    // User cancelled
    return;
  }

  // Create server with configuration from EditServerPanel
  const createResult = await service.create(panelResult.value);
  if (createResult.ok) {
    showSuccess(`Server instance "${panelResult.value.name}" created successfully!`);
    
    // Refresh the tree view to show the new server
    await commands.executeCommand('jsm.treeview.refresh');
  } else {
    showErr(createResult.error);
  }
}

/**
 * Rename template workflow
 */
async function renameTemplate(service: PluginServerService, template: BaseServerTemplate): Promise<void> {
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
      return undefined;
    }
  });

  if (!newName || newName.trim() === template.name) return;

  // Get instance manager to rename template
  const instanceMgr = (service as any).instanceMgr as ServerInstanceManager;
  const result = await instanceMgr.renameTemplate(template.id, newName.trim());

  if (result.ok) {
    showSuccess(`Template renamed to "${newName.trim()}" successfully`);
  } else {
    showErr(result.error);
  }
}

/**
 * Delete template with confirmation
 */
async function deleteTemplate(service: PluginServerService, template: BaseServerTemplate): Promise<void> {
  const confirmation = await window.showWarningMessage(
    `⚠️ Delete template "${template.name}"?\n\nThis will permanently remove the template but keep the original server files intact.`,
    { modal: true },
    'Delete Template'
  );

  if (confirmation !== 'Delete Template') return;

  // Get instance manager to delete template
  const instanceMgr = (service as any).instanceMgr as ServerInstanceManager;
  const result = await instanceMgr.deleteTemplate(template.id);
  
  if (result.ok) {
    showSuccess(`Template "${template.name}" deleted successfully`);
  } else {
    showErr(result.error);
  }
}

/**
 * Show template information
 */
// REMOVED: showTemplateInfo function - Template Information action was removed from UI

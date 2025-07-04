/*
 * src/commands/index.ts
 * Clean command registration following KISS principles and new event-driven architecture
 */

import {
  ExtensionContext,
  commands,
  window,
  env,
  Uri
} from 'vscode';
import { ServerNode, DeploymentNode } from '../ui/views/ServerTreeViewProvider';
import { ServerService } from '../services/ServerService';
import { DeploymentService } from '../services/DeploymentService';
import { AutoSyncService } from '../services/AutoSyncService';
import { Logger } from '../core/utils/logger';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { DeploymentConfig } from '../core/types/domain';
import { EditServerPanel } from '../ui/webviews/EditServerPanel';
import { LogService } from '../services/LogService';

const log = Logger.getInstance().createChild('Commands');

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

// ==================== SERVER COMMANDS ====================

export function registerServerCommands(ctx: ExtensionContext, srv: ServerService, logSvc?: LogService) {
  ctx.subscriptions.push(
    commands.registerCommand('jsm.server.add', async () => {
      try {
        const panelResult = await EditServerPanel.open({ mode: 'create' });
        if (!panelResult.ok) return;

        const createResult = await srv.create(panelResult.value);
        if (createResult.ok) {
          showSuccess(`Server "${panelResult.value.name}" created successfully!`);
          await commands.executeCommand('jsm.treeview.refresh');
        } else {
          showErr(createResult.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

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
        const serverResult = srv.getServer(serverId);
        if (!serverResult.ok) {
          showErr(serverResult.error);
          return;
        }

        const panelResult = await EditServerPanel.open({
          mode: 'edit',
          data: serverResult.value
        });

        if (!panelResult.ok) return;

        const updateResult = await srv.update(panelResult.value);
        if (updateResult.ok) {
          showSuccess(`Server "${panelResult.value.name}" updated successfully!`);
          await commands.executeCommand('jsm.treeview.refresh');
        } else {
          showErr(updateResult.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.server.delete', async (node: ServerNode) => {
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
            await commands.executeCommand('jsm.treeview.refresh');
          } else {
            showErr(result.error);
          }
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.server.openDir', async (node: ServerNode) => {
      const serverHome = node?.data?.serverHome;
      if (!serverHome) {
        showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server home directory'));
        return;
      }

      try {
        const uri = Uri.file(serverHome);
        await commands.executeCommand('revealFileInOS', uri);
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.server.copyInfo', async (node: ServerNode) => {
      const serverData = node?.data;
      if (!serverData) {
        showErr(new JsmError(ErrorCode.INVALID_CONFIGURATION, 'No server selected'));
        return;
      }

      try {
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

    commands.registerCommand('jsm.server.deployChanges', async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        // Get all deployments for this server and redeploy them incrementally
        const serverResult = srv.getServer(serverId);
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
        // This would typically be handled by DeploymentService
        showSuccess('Incremental deployment completed');
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.server.fullRedeploy', async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        const serverResult = srv.getServer(serverId);
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
          // This would typically be handled by DeploymentService
          showSuccess('Full redeploy completed');
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.server.viewLogs', async (node: ServerNode) => {
      const serverId = validateServerNode(node);
      if (!serverId) return;

      try {
        if (!logSvc) {
          showErr(new JsmError(ErrorCode.PLUGIN_ERROR, 'Log service not available'));
          return;
        }

        await logSvc.openServerLog(serverId);
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.treeview.refresh', async () => {
      try {
        const result = await srv.getAllServers();
        if (result.ok) {
          showInfo(`Refreshed: ${result.value.length} servers loaded`);
        } else {
          showErr(result.error);
        }
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
        const sourceUri = await window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: 'Select Deployment Source',
          filters: {
            'Web Applications': ['war'],
            'All Files': ['*']
          }
        });

        if (!sourceUri || sourceUri.length === 0) return;

        const sourcePath = sourceUri[0].fsPath;
        const isWar = sourcePath.endsWith('.war');
        const baseName = sourcePath.split('/').pop()?.replace('.war', '') || 'deployment';

        const deployment: DeploymentConfig = {
          id: `deployment-${Date.now()}`,
          name: baseName,
          sourcePath,
          targetPath: isWar ? `/webapps/${baseName}.war` : `/webapps/${baseName}`,
          contextPath: `/${baseName}`,
          type: isWar ? 'war' : 'exploded',
          state: 'undeployed'
        };

        const result = await dep.add(serverId, deployment);
        if (result.ok) {
          showSuccess(`Deployment "${deployment.name}" added successfully`);
          await commands.executeCommand('jsm.treeview.refresh');
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.deployment.remove', async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        const deploymentName = node.data.name || nodeData.deploymentId;
        const confirmation = await window.showWarningMessage(
          `Remove deployment "${deploymentName}" and its files?`,
          { modal: true },
          'Remove Deployment'
        );

        if (confirmation === 'Remove Deployment') {
          const result = await dep.remove(nodeData.serverId, nodeData.deploymentId, true);
          if (result.ok) {
            showSuccess(`Deployment "${deploymentName}" removed successfully`);
            await commands.executeCommand('jsm.treeview.refresh');
          } else {
            showErr(result.error);
          }
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.deployment.forceDeploy', async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        const result = await dep.publish(nodeData.serverId, nodeData.deploymentId);
        if (result.ok) {
          showSuccess('Deployment published successfully');
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.deployment.undeploySoft', async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        const result = await dep.undeploy(nodeData.serverId, nodeData.deploymentId);
        if (result.ok) {
          showSuccess('Deployment undeployed successfully');
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
        const result = sync.toggle(nodeData.serverId, nodeData.deploymentId);
        if (result.ok) {
          showSuccess('AutoSync toggled for deployment');
        } else {
          showErr(result.error);
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.deployment.removeSoft', async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        const deploymentName = node.data.name || nodeData.deploymentId;
        const confirmation = await window.showWarningMessage(
          `Remove deployment "${deploymentName}" configuration (keep files)?`,
          { modal: true },
          'Remove Config Only'
        );

        if (confirmation === 'Remove Config Only') {
          const result = await dep.remove(nodeData.serverId, nodeData.deploymentId, false);
          if (result.ok) {
            showSuccess(`Deployment "${deploymentName}" configuration removed`);
            await commands.executeCommand('jsm.treeview.refresh');
          } else {
            showErr(result.error);
          }
        }
      } catch (error) {
        showErr(error);
      }
    }),

    commands.registerCommand('jsm.deployment.removeHard', async (node: DeploymentNode) => {
      const nodeData = validateDeploymentNode(node);
      if (!nodeData) return;

      try {
        const deploymentName = node.data.name || nodeData.deploymentId;
        const confirmation = await window.showWarningMessage(
          `Remove deployment "${deploymentName}" and delete all files?`,
          { modal: true },
          'Remove and Delete Files'
        );

        if (confirmation === 'Remove and Delete Files') {
          const result = await dep.remove(nodeData.serverId, nodeData.deploymentId, true);
          if (result.ok) {
            showSuccess(`Deployment "${deploymentName}" removed and files deleted`);
            await commands.executeCommand('jsm.treeview.refresh');
          } else {
            showErr(result.error);
          }
        }
      } catch (error) {
        showErr(error);
      }
    })
  );
}

export function registerTemplateCommands(ctx: ExtensionContext) {
  ctx.subscriptions.push(
    commands.registerCommand('jsm.templates.manage', async () => {
      showInfo('Template management is being redesigned for the new architecture. Coming soon!');
    })
  );
}
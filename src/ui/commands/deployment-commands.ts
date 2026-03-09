import * as vscode from 'vscode';
import type { SyncMode } from '@core/types';
import type { ConfigService } from '@app/config/ConfigService';
import type { ServerTreeViewProvider } from '@ui/tree/ServerTreeViewProvider';
import type { DeploymentFormPanel } from '@ui/webviews/panels/DeploymentFormPanel';
import {
  showErr,
  showSuccess,
  deferredStub,
  isDeploymentNode,
  isServerNode,
  registerMany,
} from './shared';

// ── Dependency contract ─────────────────────────────────────────────────────

export interface DeploymentCommandsDeps {
  configService: ConfigService;
  treeProvider: ServerTreeViewProvider;
  deploymentFormPanel: DeploymentFormPanel;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function nextSyncMode(current: SyncMode): SyncMode {
  const cycle: SyncMode[] = ['off', 'manual', 'auto'];
  return cycle[(cycle.indexOf(current) + 1) % cycle.length];
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerDeploymentCommands(
  deps: DeploymentCommandsDeps,
): vscode.Disposable[] {
  const { configService, treeProvider, deploymentFormPanel } = deps;

  return registerMany([

    // §8.2 — jsm.deployment.add
    ['jsm.deployment.add', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      deploymentFormPanel.open('create', arg.serverId);
    }],

    // §8.2 — jsm.deployment.sync
    ['jsm.deployment.sync', (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      void vscode.window.showInformationMessage(
        `Sync queued for "${arg.deploymentConfig.deployName}".`,
      );
      // Full wiring requires OperationContext; handled via queue in Phase 8.
    }],

    // §8.2 — jsm.deployment.fullRedeploy
    ['jsm.deployment.fullRedeploy', (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      void vscode.window.showInformationMessage(
        `Full Redeploy queued for "${arg.deploymentConfig.deployName}".`,
      );
      // Full wiring requires OperationContext; handled via queue in Phase 8.
    }],

    // §8.2 — jsm.deployment.undeploy
    ['jsm.deployment.undeploy', (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      void vscode.window.showInformationMessage(
        `Undeploy queued for "${arg.deploymentConfig.deployName}".`,
      );
      // Full wiring requires OperationContext; handled via queue in Phase 8.
    }],

    // §8.2 — jsm.deployment.toggleAutosync
    ['jsm.deployment.toggleAutosync', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const server = configService.getServer(arg.serverId);
      if (!server) return;

      const dep = server.deployments.find(d => d.id === arg.deploymentId);
      if (!dep) return;

      const newMode = nextSyncMode(dep.syncMode);
      const updatedDep = { ...dep, syncMode: newMode };
      const updatedServer = {
        ...server,
        deployments: server.deployments.map(d =>
          d.id === arg.deploymentId ? updatedDep : d,
        ),
      };

      const result = await configService.updateServer(updatedServer);
      if (!result.ok) { showErr(result.error); return; }

      showSuccess(`AutoSync for "${dep.deployName}" set to "${newMode}".`);
      treeProvider.requestRefresh();
    }],

    // §8.2 — jsm.deployment.configureIgnoreGlobs (deferred-v1.1)
    ['jsm.deployment.configureIgnoreGlobs', deferredStub('Configure Ignore Globs')],

    // §8.2 — jsm.deployment.edit
    ['jsm.deployment.edit', (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      deploymentFormPanel.open('edit', arg.serverId, arg.deploymentId);
    }],

    // §8.2 — jsm.deployment.remove
    ['jsm.deployment.remove', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const answer = await vscode.window.showWarningMessage(
        `Remove deployment "${arg.deploymentConfig.deployName}"? This cannot be undone.`,
        { modal: true },
        'Remove',
      );
      if (answer !== 'Remove') return;

      const result = await configService.removeDeployment(
        arg.serverId,
        arg.deploymentId,
      );
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Deployment "${arg.deploymentConfig.deployName}" removed.`);
      treeProvider.requestRefresh();
    }],

    // §8.2 — jsm.deployment.openLogs (deferred-v1.1)
    ['jsm.deployment.openLogs', deferredStub('Deployment Logs')],
  ]);
}

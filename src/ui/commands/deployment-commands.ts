import * as vscode from 'vscode';
import type { SyncMode, OperationContext } from '@core/types';
import type { ConfigService } from '@app/config/ConfigService';
import type { DeploymentService } from '@app/deployment/DeploymentService';
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
  deployService: DeploymentService;
  treeProvider: ServerTreeViewProvider;
  deploymentFormPanel: DeploymentFormPanel;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function nextSyncMode(current: SyncMode): SyncMode {
  const cycle: SyncMode[] = ['off', 'manual', 'auto'];
  return cycle[(cycle.indexOf(current) + 1) % cycle.length];
}

function makeOpCtx(serverId: string, kind: OperationContext['kind'], deploymentId?: string): OperationContext {
  return {
    operationId: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    serverId,
    kind,
    targetDeploymentId: deploymentId,
    startedAt: Date.now(),
    timeoutMs: 60_000,
    cancel: { isCancelled: false, onCancelled: () => ({ dispose: () => {} }) },
    progress: { report: () => {} },
    output: { append: () => {}, appendLine: () => {}, clear: () => {} },
  };
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerDeploymentCommands(
  deps: DeploymentCommandsDeps,
): vscode.Disposable[] {
  const { configService, deployService, treeProvider, deploymentFormPanel } = deps;

  return registerMany([

    // §8.2 — jsm.deployment.add
    ['jsm.deployment.add', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      deploymentFormPanel.open('create', arg.serverId);
    }],

    // §8.2 — jsm.deployment.sync
    ['jsm.deployment.sync', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const config = configService.getServer(arg.serverId);
      const dep = config?.deployments.find(d => d.id === arg.deploymentId);
      if (!config || !dep) return;
      const ctx = makeOpCtx(arg.serverId, 'DeployFull', arg.deploymentId);
      const result = await deployService.fullRedeploy(ctx, config, dep);
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Sync completed for "${dep.deployName}".`);
    }],

    // §8.2 — jsm.deployment.fullRedeploy
    ['jsm.deployment.fullRedeploy', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const config = configService.getServer(arg.serverId);
      const dep = config?.deployments.find(d => d.id === arg.deploymentId);
      if (!config || !dep) return;
      const ctx = makeOpCtx(arg.serverId, 'DeployFull', arg.deploymentId);
      const result = await deployService.fullRedeploy(ctx, config, dep);
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Full Redeploy completed for "${dep.deployName}".`);
    }],

    // §8.2 — jsm.deployment.undeploy
    ['jsm.deployment.undeploy', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const config = configService.getServer(arg.serverId);
      const dep = config?.deployments.find(d => d.id === arg.deploymentId);
      if (!config || !dep) return;
      const ctx = makeOpCtx(arg.serverId, 'Undeploy', arg.deploymentId);
      const result = await deployService.undeploy(ctx, config, dep);
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Undeployed "${dep.deployName}".`);
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

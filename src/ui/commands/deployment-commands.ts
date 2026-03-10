import * as vscode from 'vscode';
import type { SyncMode, OperationContext, ServerConfig, DeploymentConfig } from '@core/types';
import type { Result } from '@core/result';
import type { JsmError } from '@core/errors/JsmError';
import type { WorkspaceServiceRegistry } from '@app/config';
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
  workspaceRegistry?: WorkspaceServiceRegistry;
  configService?: {
    getServer(serverId: string): ServerConfig | undefined;
    updateServer(config: ServerConfig): Promise<Result<void, JsmError>>;
    removeDeployment(serverId: string, deploymentId: string): Promise<Result<void, JsmError>>;
  };
  deployService: DeploymentService;
  treeProvider: ServerTreeViewProvider;
  deploymentFormPanel: DeploymentFormPanel | {
    open?(mode: 'create' | 'edit', serverId: string, deploymentId?: string): void;
    openCreate?(locator: { workspaceFolderUri: string; serverId: string }): void;
    openEdit?(locator: { workspaceFolderUri: string; serverId: string }, deploymentId: string): void;
  };
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
  const { workspaceRegistry, configService, deployService, treeProvider, deploymentFormPanel } = deps;
  const resolveServer = (workspaceFolderUri: string, serverId: string) => workspaceRegistry
    ? workspaceRegistry.getServer({ workspaceFolderUri, serverId })
    : configService?.getServer(serverId);

  return registerMany([

    // §8.2 — jsm.deployment.add
    ['jsm.deployment.add', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      if (deploymentFormPanel.openCreate) {
        deploymentFormPanel.openCreate({
          workspaceFolderUri: arg.workspaceFolderUri,
          serverId: arg.serverId,
        });
        return;
      }
      deploymentFormPanel.open?.('create', arg.serverId);
    }],

    // §8.2 — jsm.deployment.sync
    ['jsm.deployment.sync', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      const dep = config?.deployments.find((d: DeploymentConfig) => d.id === arg.deploymentId);
      if (!config || !dep) return;
      const ctx = makeOpCtx(arg.serverKey, 'DeployFull', arg.deploymentId);
      const result = await deployService.fullRedeploy(ctx, config, dep);
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Sync completed for "${dep.deployName}".`);
    }],

    // §8.2 — jsm.deployment.fullRedeploy
    ['jsm.deployment.fullRedeploy', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      const dep = config?.deployments.find((d: DeploymentConfig) => d.id === arg.deploymentId);
      if (!config || !dep) return;
      const ctx = makeOpCtx(arg.serverKey, 'DeployFull', arg.deploymentId);
      const result = await deployService.fullRedeploy(ctx, config, dep);
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Full Redeploy completed for "${dep.deployName}".`);
    }],

    // §8.2 — jsm.deployment.undeploy
    ['jsm.deployment.undeploy', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      const dep = config?.deployments.find((d: DeploymentConfig) => d.id === arg.deploymentId);
      if (!config || !dep) return;
      const ctx = makeOpCtx(arg.serverKey, 'Undeploy', arg.deploymentId);
      const result = await deployService.undeploy(ctx, config, dep);
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Undeployed "${dep.deployName}".`);
    }],

    // §8.2 — jsm.deployment.toggleAutosync
    ['jsm.deployment.toggleAutosync', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const locator = {
        workspaceFolderUri: arg.workspaceFolderUri,
        serverId: arg.serverId,
      };
      const server = resolveServer(locator.workspaceFolderUri, locator.serverId);
      if (!server) return;

      const dep = server.deployments.find((d: DeploymentConfig) => d.id === arg.deploymentId);
      if (!dep) return;

      const newMode = nextSyncMode(dep.syncMode);
      const updatedDep = { ...dep, syncMode: newMode };
      const updatedServer = {
        ...server,
        deployments: server.deployments.map((d: DeploymentConfig) =>
          d.id === arg.deploymentId ? updatedDep : d,
        ),
      };

      const result = workspaceRegistry
        ? await workspaceRegistry.updateServer(locator, updatedServer)
        : await configService?.updateServer(updatedServer);
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }

      showSuccess(`AutoSync for "${dep.deployName}" set to "${newMode}".`);
      treeProvider.requestRefresh();
    }],

    // §8.2 — jsm.deployment.configureIgnoreGlobs (deferred-v1.1)
    ['jsm.deployment.configureIgnoreGlobs', deferredStub('Configure Ignore Globs')],

    // §8.2 — jsm.deployment.edit
    ['jsm.deployment.edit', (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      if (deploymentFormPanel.openEdit) {
        deploymentFormPanel.openEdit({
          workspaceFolderUri: arg.workspaceFolderUri,
          serverId: arg.serverId,
        }, arg.deploymentId);
        return;
      }
      deploymentFormPanel.open?.('edit', arg.serverId, arg.deploymentId);
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

      const result = workspaceRegistry
        ? await workspaceRegistry.removeDeployment({
          workspaceFolderUri: arg.workspaceFolderUri,
          serverId: arg.serverId,
        }, arg.deploymentId)
        : await configService?.removeDeployment(arg.serverId, arg.deploymentId);
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Deployment "${arg.deploymentConfig.deployName}" removed.`);
      treeProvider.requestRefresh();
    }],

    // §8.2 — jsm.deployment.openLogs (deferred-v1.1)
    ['jsm.deployment.openLogs', deferredStub('Deployment Logs')],
  ]);
}

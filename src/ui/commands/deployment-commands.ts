import * as vscode from 'vscode';
import type { SyncMode, OperationContext, ServerConfig, DeploymentConfig } from '@core/types';
import type { Result } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { WorkspaceServiceRegistry } from '@app/config';
import type { DeploymentService } from '@app/deployment/DeploymentService';
import type { ServerTreeViewProvider } from '@ui/tree/ServerTreeViewProvider';
import type { DeploymentFormPanel } from '@ui/webviews/panels/DeploymentFormPanel';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { LogSources } from '@plugins/interfaces/IServerPlugin';
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
  pluginRegistry: PluginRegistry;
  deployService: DeploymentService;
  treeProvider: ServerTreeViewProvider;
  deploymentFormPanel: DeploymentFormPanel | {
    open?(mode: 'create' | 'edit', serverId: string, deploymentId?: string): void;
    openCreate?(locator: { workspaceFolderUri: string; serverId: string }): void;
    openEdit?(locator: { workspaceFolderUri: string; serverId: string }, deploymentId: string): void;
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Collect file log sources from LogSources (only kind === 'file' with path). */
function collectFileLogPaths(sources: LogSources): { path: string; title: string }[] {
  const add = (out: { path: string; title: string }[], s?: { kind: string; path?: string; title?: string; id: string }) => {
    if (s?.kind === 'file' && s.path) out.push({ path: s.path, title: s.title ?? s.id });
  };
  const out: { path: string; title: string }[] = [];
  add(out, sources.primary);
  sources.others.forEach(o => add(out, o));
  return out;
}

async function openLogFile(filePath: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(document, { preview: false });
}

function nextSyncMode(current: SyncMode): SyncMode {
  const cycle: SyncMode[] = ['manual', 'auto'];
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
  const { workspaceRegistry, configService, pluginRegistry, deployService, treeProvider, deploymentFormPanel } = deps;
  const resolveServer = (workspaceFolderUri: string, serverId: string) => workspaceRegistry
    ? workspaceRegistry.getServer({ workspaceFolderUri, serverId })
    : configService?.getServer(serverId);

  return registerMany([

    // §8.2 — jsm.deployment.add
    ['jsm.deployment.add', async (arg: unknown) => {
      // Check if this is a SPA form submission (has deployment data)
      if (arg && typeof arg === 'object' && 'deployment' in arg) {
        const spaArg = arg as { serverId: string; serverKey: string; workspaceFolderUri: string; deployment: DeploymentConfig };
        const config = resolveServer(spaArg.workspaceFolderUri, spaArg.serverId);
        if (!config) { showErr(new JsmError({ code: ErrorCode.InvalidConfig, message: 'Server not found' })); return; }
        
        const result = workspaceRegistry
          ? await workspaceRegistry.addDeployment({ workspaceFolderUri: spaArg.workspaceFolderUri, serverId: spaArg.serverId }, spaArg.deployment)
          : await configService?.updateServer({ ...config, deployments: [...config.deployments, spaArg.deployment] });
        if (!result) return;
        if (!result.ok) { showErr(result.error); return; }
        showSuccess(`Deployment "${spaArg.deployment.deployName}" added.`);
        treeProvider.requestRefresh();
        return;
      }
      
      // Legacy: open form panel
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

    // §8.2 — jsm.deployment.redeploy
    ['jsm.deployment.redeploy', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      const dep = config?.deployments.find((d: DeploymentConfig) => d.id === arg.deploymentId);
      if (!config || !dep) return;
      const ctx = makeOpCtx(arg.serverKey, 'DeployFull', arg.deploymentId);
      const result = await deployService.fullRedeploy(ctx, config, dep);
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Redeploy completed for "${dep.deployName}".`);
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
      if (dep.type !== 'exploded') return;

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
    ['jsm.deployment.edit', async (arg: unknown) => {
      // Check if this is a SPA form submission (has deployment data)
      if (arg && typeof arg === 'object' && 'deployment' in arg) {
        const spaArg = arg as { serverId: string; serverKey: string; workspaceFolderUri: string; deployment: DeploymentConfig };
        const config = resolveServer(spaArg.workspaceFolderUri, spaArg.serverId);
        if (!config) { showErr(new JsmError({ code: ErrorCode.InvalidConfig, message: 'Server not found' })); return; }
        
        const updatedServer = {
          ...config,
          deployments: config.deployments.map((d: DeploymentConfig) =>
            d.id === spaArg.deployment.id ? spaArg.deployment : d,
          ),
        };
        
        const result = workspaceRegistry
          ? await workspaceRegistry.updateServer({ workspaceFolderUri: spaArg.workspaceFolderUri, serverId: spaArg.serverId }, updatedServer)
          : await configService?.updateServer(updatedServer);
        if (!result) return;
        if (!result.ok) { showErr(result.error); return; }
        showSuccess(`Deployment "${spaArg.deployment.deployName}" updated.`);
        treeProvider.requestRefresh();
        return;
      }
      
      // Legacy: open form panel
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
    ['jsm.deployment.openLogs', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;

      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      if (!config) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `Server not found for deployment.`,
          details: `workspaceFolderUri=${arg.workspaceFolderUri}, serverId=${arg.serverId}`,
        }));
        return;
      }

      const plugin = pluginRegistry.get(config.type);
      if (!plugin) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `No plugin registered for server type '${config.type}'.`,
        }));
        return;
      }

      const sourcesResult = await plugin.getLogSources(config);
      if (!sourcesResult.ok) {
        showErr(sourcesResult.error);
        return;
      }

      const files = collectFileLogPaths(sourcesResult.value);
      if (files.length === 0) {
        await vscode.window.showInformationMessage(
          `No file log sources are available for server "${config.name}".`,
        );
        return;
      }

      const openOne = async (filePath: string): Promise<void> => {
        try {
          await openLogFile(filePath);
        } catch (e) {
          showErr(JsmError.fromUnknown(e, ErrorCode.InvalidConfig));
        }
      };

      if (files.length === 1) {
        await openOne(files[0].path);
        return;
      }

      const picked = await vscode.window.showQuickPick(
        files.map(f => ({ label: f.title, description: f.path, path: f.path })),
        { placeHolder: 'Select a log file to open', ignoreFocusOut: true },
      );
      if (!picked) return;
      await openOne(picked.path);
    }],
  ]);
}

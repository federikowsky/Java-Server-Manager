import * as vscode from 'vscode';
import {
  deploymentDraftToConfig,
} from '@core/authoring';
import type { DeploymentAuthoringDraft } from '@core/authoring';
import type { SyncMode, ServerConfig, DeploymentConfig } from '@core/types';
import type { Result } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { WorkspaceServiceRegistry } from '@app/config';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { ServerTreeViewProvider } from '@ui/tree/ServerTreeViewProvider';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { LogSources } from '@plugins/interfaces/IServerPlugin';
import {
  showErr,
  showSuccess,
  deferredStub,
  isDeploymentNode,
  isServerNode,
  registerMany,
  runUntilQueueIdleWithProgressResult,
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
  lifecycle: ServerLifecycle;
  treeProvider: ServerTreeViewProvider;
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

// ── Registration ────────────────────────────────────────────────────────────

export function registerDeploymentCommands(
  deps: DeploymentCommandsDeps,
): vscode.Disposable[] {
  const { workspaceRegistry, configService, pluginRegistry, lifecycle, treeProvider } = deps;
  const resolveServer = (workspaceFolderUri: string, serverId: string) => workspaceRegistry
    ? workspaceRegistry.getServer({ workspaceFolderUri, serverId })
    : configService?.getServer(serverId);
  const resolveDeployment = (workspaceFolderUri: string, serverId: string, deploymentId: string) =>
    resolveServer(workspaceFolderUri, serverId)?.deployments.find((d: DeploymentConfig) => d.id === deploymentId);

  return registerMany([

    // §8.2 — jsm.deployment.add
    ['jsm.deployment.add', async (arg: unknown) => {
      if (
        arg
        && typeof arg === 'object'
        && 'serverId' in arg
        && 'workspaceFolderUri' in arg
        && 'draft' in arg
      ) {
        const spaArg = arg as {
          serverId: string;
          serverKey: string;
          workspaceFolderUri: string;
          draft?: unknown;
        };
        const config = resolveServer(spaArg.workspaceFolderUri, spaArg.serverId);
        if (!config) {
          return { ok: false, message: 'Server not found' };
        }

        const draft = spaArg.draft && typeof spaArg.draft === 'object'
          ? (spaArg.draft as DeploymentAuthoringDraft)
          : undefined;
        if (!draft) {
          return { ok: false, message: 'Invalid deployment draft payload.' };
        }

        const deployment = deploymentDraftToConfig(draft, draft.id ?? crypto.randomUUID());
        const result = workspaceRegistry
          ? await workspaceRegistry.addDeployment({ workspaceFolderUri: spaArg.workspaceFolderUri, serverId: spaArg.serverId }, deployment)
          : await configService?.updateServer({ ...config, deployments: [...config.deployments, deployment] });
        if (!result) return { ok: false, message: 'Unable to add deployment.' };
        if (!result.ok) return { ok: false, message: result.error.message };
        treeProvider.requestRefresh();
        return {
          ok: true,
          message: `Deployment "${deployment.deployName}" added.`,
          data: {
            serverId: spaArg.serverId,
            deploymentId: deployment.id,
          },
        };
      }
      
      if (!isServerNode(arg)) return;
      void vscode.commands.executeCommand('jsm.dashboard.open', {
        type: 'deployment',
        serverId: arg.serverId,
        mode: 'create',
        globalTab: 'home',
      });
      return undefined;
    }],

    // §8.2 — jsm.deployment.redeploy
    ['jsm.deployment.redeploy', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      const dep = config?.deployments.find((d: DeploymentConfig) => d.id === arg.deploymentId);
      if (!config || !dep) return;
      const enq = lifecycle.enqueueDeployFull(arg.serverKey, arg.deploymentId);
      if (!enq.ok) {
        showErr(enq.error);
        return;
      }
      const done = await runUntilQueueIdleWithProgressResult(
        { title: `Redeploying ${dep.deployName}...`, serverKey: arg.serverKey },
        lifecycle,
      );
      if (!done.ok) {
        showErr(done.error);
        return;
      }
      showSuccess(`Redeploy completed for "${dep.deployName}".`);
    }],

    // §8.2 — jsm.deployment.undeploy
    ['jsm.deployment.undeploy', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      const dep = config?.deployments.find((d: DeploymentConfig) => d.id === arg.deploymentId);
      if (!config || !dep) return;
      const enq = lifecycle.enqueueUndeploy(arg.serverKey, arg.deploymentId);
      if (!enq.ok) {
        showErr(enq.error);
        return;
      }
      const done = await runUntilQueueIdleWithProgressResult(
        { title: `Undeploying ${dep.deployName}...`, serverKey: arg.serverKey },
        lifecycle,
      );
      if (!done.ok) {
        showErr(done.error);
        return;
      }
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
    ['jsm.deployment.edit', async (arg: unknown) => {
      if (
        arg
        && typeof arg === 'object'
        && 'serverId' in arg
        && 'workspaceFolderUri' in arg
        && 'draft' in arg
      ) {
        const spaArg = arg as {
          serverId: string;
          serverKey: string;
          workspaceFolderUri: string;
          draft?: unknown;
          deploymentId?: string;
        };
        const config = resolveServer(spaArg.workspaceFolderUri, spaArg.serverId);
        if (!config) {
          return { ok: false, message: 'Server not found' };
        }

        const draft = spaArg.draft && typeof spaArg.draft === 'object'
          ? { ...(spaArg.draft as DeploymentAuthoringDraft), id: spaArg.deploymentId }
          : undefined;
        if (!draft?.id) {
          return { ok: false, message: 'Invalid deployment draft payload.' };
        }

        const deployment = deploymentDraftToConfig(draft, draft.id);
        const updatedServer = {
          ...config,
          deployments: config.deployments.map((d: DeploymentConfig) =>
            d.id === deployment.id ? deployment : d,
          ),
        };

        const result = workspaceRegistry
          ? await workspaceRegistry.updateServer({ workspaceFolderUri: spaArg.workspaceFolderUri, serverId: spaArg.serverId }, updatedServer)
          : await configService?.updateServer(updatedServer);
        if (!result) return { ok: false, message: 'Unable to update deployment.' };
        if (!result.ok) return { ok: false, message: result.error.message };
        treeProvider.requestRefresh();
        return {
          ok: true,
          message: `Deployment "${deployment.deployName}" updated.`,
          data: {
            serverId: spaArg.serverId,
            deploymentId: deployment.id,
          },
        };
      }
      
      if (!isDeploymentNode(arg)) return;
      void vscode.commands.executeCommand('jsm.dashboard.open', {
        type: 'deployment',
        id: arg.deploymentId,
        serverId: arg.serverId,
        mode: 'edit',
        globalTab: 'home',
      });
      return undefined;
    }],

    // §8.2 — jsm.deployment.remove
    ['jsm.deployment.remove', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const dep = arg.deploymentConfig ?? resolveDeployment(arg.workspaceFolderUri, arg.serverId, arg.deploymentId);
      if (!dep) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Deployment not found.',
        }));
        return;
      }
      const answer = await vscode.window.showWarningMessage(
        `Remove deployment "${dep.deployName}"? This cannot be undone.`,
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
      showSuccess(`Deployment "${dep.deployName}" removed.`);
      treeProvider.requestRefresh();
    }],

    // Reveal deployment source in OS explorer / VS Code explorer (spec §17.3 download/export slot).
    ['jsm.deployment.revealSource', async (arg: unknown) => {
      if (!isDeploymentNode(arg)) return;
      const dep =
        arg.deploymentConfig
        ?? resolveDeployment(arg.workspaceFolderUri, arg.serverId, arg.deploymentId);
      const raw = dep && typeof (dep as DeploymentConfig).sourcePath === 'string'
        ? (dep as DeploymentConfig).sourcePath.trim()
        : '';
      if (!raw) {
        void vscode.window.showWarningMessage('JSM: No source path to reveal.');
        return;
      }
      const uri = vscode.Uri.file(raw);
      try {
        await vscode.commands.executeCommand('revealInExplorer', uri);
      } catch (e) {
        showErr(JsmError.fromUnknown(e, ErrorCode.InvalidConfig));
      }
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

import * as vscode from 'vscode';
import {
  deploymentDraftToConfig,
} from '@core/authoring';
import type { DeploymentAuthoringDraft } from '@core/authoring';
import type { SyncMode, ServerConfig, DeploymentConfig, DeploymentId, ServerId } from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { makeWorkspaceServerKey, type WorkspaceServiceRegistry } from '@app/config';
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
  runQueuedActionWithProgressResult,
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

type DeploymentDraftCommandArg = {
  serverId: string;
  serverKey: string;
  workspaceFolderUri: string;
  draft?: unknown;
  deploymentId?: string;
};

type DeploymentResolutionArg = {
  workspaceFolderUri: string;
  serverId: string;
  serverKey: string;
  deploymentId: string;
  deploymentConfig?: DeploymentConfig;
};

type DeploymentCommandResult = {
  ok: boolean;
  message: string;
  data?: {
    serverId: string;
    deploymentId: string;
  };
};

type ResolvedDeploymentContext = {
  server: ServerConfig;
  deployment: DeploymentConfig;
};

function deploymentSelectionRequiredError(actionLabel: string): JsmError {
  return new JsmError({
    code: ErrorCode.InvalidConfig,
    message: `${actionLabel} requires a deployment selected in the Java Server Manager view.`,
  });
}

function serverSelectionRequiredError(actionLabel: string): JsmError {
  return new JsmError({
    code: ErrorCode.InvalidConfig,
    message: `${actionLabel} requires a server selected in the Java Server Manager view.`,
  });
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
  return current === 'manual' ? 'auto' : 'manual';
}

function asDeploymentDraftCommandArg(arg: unknown): DeploymentDraftCommandArg | undefined {
  if (
    !arg
    || typeof arg !== 'object'
    || !('serverId' in arg)
    || !('workspaceFolderUri' in arg)
    || !('draft' in arg)
  ) {
    return undefined;
  }

  return arg as DeploymentDraftCommandArg;
}

function resolveDeploymentConfig(
  resolveServer: (workspaceFolderUri: string, serverId: string) => ServerConfig | undefined,
  arg: DeploymentResolutionArg,
  options: { allowInlineDeployment?: boolean } = {},
): { server: ServerConfig | undefined; deployment: DeploymentConfig | undefined } {
  const server = resolveServer(arg.workspaceFolderUri, arg.serverId);
  const deployment = server?.deployments.find((candidate: DeploymentConfig) => candidate.id === arg.deploymentId)
    ?? (options.allowInlineDeployment ? arg.deploymentConfig : undefined);
  return { server, deployment };
}

function resolveDeploymentDraft(
  spaArg: DeploymentDraftCommandArg,
  deploymentId?: string,
): DeploymentAuthoringDraft | undefined {
  if (!spaArg.draft || typeof spaArg.draft !== 'object') {
    return undefined;
  }

  return deploymentId
    ? { ...(spaArg.draft as DeploymentAuthoringDraft), id: deploymentId }
    : (spaArg.draft as DeploymentAuthoringDraft);
}

function replaceDeployment(
  server: ServerConfig,
  deploymentId: DeploymentId,
  deployment: DeploymentConfig,
): ServerConfig {
  return {
    ...server,
    deployments: server.deployments.map(candidate =>
      candidate.id === deploymentId ? deployment : candidate,
    ),
  };
}

function successResult(
  action: 'added' | 'updated',
  serverId: ServerId,
  deployment: DeploymentConfig,
): DeploymentCommandResult {
  const verb = action === 'added' ? 'added' : 'updated';
  return {
    ok: true,
    message: `Deployment "${deployment.deployName}" ${verb}.`,
    data: {
      serverId,
      deploymentId: deployment.id,
    },
  };
}

async function pickLogFilePath(files: Array<{ path: string; title: string }>): Promise<string | undefined> {
  if (files.length === 0) {
    return undefined;
  }

  if (files.length === 1) {
    return files[0].path;
  }

  const picked = await vscode.window.showQuickPick(
    files.map(file => ({ label: file.title, description: file.path, path: file.path })),
    { placeHolder: 'Select a log file to open', ignoreFocusOut: true },
  );
  return picked?.path;
}

async function openLogFileSafely(filePath: string): Promise<Result<void, JsmError>> {
  try {
    await openLogFile(filePath);
    return ok(undefined);
  } catch (e) {
    return err(JsmError.fromUnknown(e, ErrorCode.InvalidConfig));
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerDeploymentCommands(
  deps: DeploymentCommandsDeps,
): vscode.Disposable[] {
  const { workspaceRegistry, configService, pluginRegistry, lifecycle, treeProvider } = deps;
  const resolveServer = (workspaceFolderUri: string, serverId: string) => workspaceRegistry
    ? workspaceRegistry.getServer({ workspaceFolderUri, serverId })
    : configService?.getServer(serverId);
  const resolveDeployment = (
    arg: DeploymentResolutionArg,
    options: { allowInlineDeployment?: boolean } = {},
  ) => resolveDeploymentConfig(resolveServer, arg, options);

  const updateServerConfig = async (
    workspaceFolderUri: string,
    serverId: string,
    updatedServer: ServerConfig,
  ) => workspaceRegistry
    ? workspaceRegistry.updateServer({ workspaceFolderUri, serverId }, updatedServer)
    : configService?.updateServer(updatedServer);

  const runQueuedDeploymentAction = async (
    serverKey: string,
    title: string,
    action: () => Result<void, JsmError>,
    successMessage: string,
  ): Promise<void> => {
    const result = await runQueuedActionWithProgressResult(
      { title, serverKey },
      lifecycle,
      action,
    );
    if (!result.ok) {
      showErr(result.error);
      return;
    }

    showSuccess(successMessage);
  };

  const requireDeploymentContext = (
    arg: DeploymentResolutionArg,
    options: { allowInlineDeployment?: boolean } = {},
  ): ResolvedDeploymentContext | undefined => {
    const { server, deployment } = resolveDeployment(arg, options);
    if (!server || !deployment) {
      showErr(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: 'Deployment not found.',
      }));
      return undefined;
    }
    return { server, deployment };
  };

  const requireDeploymentArg = (
    arg: unknown,
    actionLabel: string,
  ): DeploymentResolutionArg | undefined => {
    if (isDeploymentNode(arg)) {
      return arg;
    }

    showErr(deploymentSelectionRequiredError(actionLabel));
    return undefined;
  };

  const requireServerArg = (
    arg: unknown,
    actionLabel: string,
  ): { serverId: string; serverKey?: string; workspaceFolderUri: string } | undefined => {
    if (isServerNode(arg)) {
      return arg;
    }

    showErr(serverSelectionRequiredError(actionLabel));
    return undefined;
  };

  const openDeploymentDashboard = (
    arg: { serverId: string; serverKey?: string; workspaceFolderUri: string; deploymentId?: string },
    mode: 'create' | 'edit',
  ): void => {
    const serverKey = arg.serverKey || (workspaceRegistry ? makeWorkspaceServerKey(arg.workspaceFolderUri, arg.serverId) : arg.serverId);
    void vscode.commands.executeCommand('jsm.dashboard.open', {
      type: 'deployment',
      serverId: arg.serverId,
      serverKey,
      workspaceFolderUri: arg.workspaceFolderUri,
      id: arg.deploymentId,
      mode,
      globalTab: 'home',
    });
  };

  const persistAddedDeployment = async (spaArg: DeploymentDraftCommandArg) => {
    const config = resolveServer(spaArg.workspaceFolderUri, spaArg.serverId);
    if (!config) {
      return { ok: false, message: 'Server not found' } as const;
    }

    const draft = resolveDeploymentDraft(spaArg);
    if (!draft) {
      return { ok: false, message: 'Invalid deployment draft payload.' } as const;
    }

    const deployment = deploymentDraftToConfig(draft, draft.id ?? crypto.randomUUID());
    const result = workspaceRegistry
      ? await workspaceRegistry.addDeployment({ workspaceFolderUri: spaArg.workspaceFolderUri, serverId: spaArg.serverId }, deployment)
      : await configService?.updateServer({ ...config, deployments: [...config.deployments, deployment] });
    if (!result) return { ok: false, message: 'Unable to add deployment.' } as const;
    if (!result.ok) return { ok: false, message: result.error.message } as const;
    treeProvider.requestRefresh();
    return successResult('added', spaArg.serverId, deployment);
  };

  const persistEditedDeployment = async (spaArg: DeploymentDraftCommandArg) => {
    const config = resolveServer(spaArg.workspaceFolderUri, spaArg.serverId);
    if (!config) {
      return { ok: false, message: 'Server not found' } as const;
    }

    const draft = resolveDeploymentDraft(spaArg, spaArg.deploymentId);
    if (!draft?.id) {
      return { ok: false, message: 'Invalid deployment draft payload.' } as const;
    }

    const deployment = deploymentDraftToConfig(draft, draft.id);
    const updatedServer = replaceDeployment(config, deployment.id, deployment);

    const result = await updateServerConfig(spaArg.workspaceFolderUri, spaArg.serverId, updatedServer);
    if (!result) return { ok: false, message: 'Unable to update deployment.' } as const;
    if (!result.ok) return { ok: false, message: result.error.message } as const;
    treeProvider.requestRefresh();
    return successResult('updated', spaArg.serverId, deployment);
  };

  return registerMany([

    // §8.2 — jsm.deployment.add
    ['jsm.deployment.add', async (arg: unknown) => {
      const spaArg = asDeploymentDraftCommandArg(arg);
      if (spaArg) {
        return persistAddedDeployment(spaArg);
      }

      const resolvedArg = requireServerArg(arg, 'Adding a deployment');
      if (!resolvedArg) return;
      openDeploymentDashboard(resolvedArg, 'create');
      return undefined;
    }],

    // §8.2 — jsm.deployment.redeploy
    ['jsm.deployment.redeploy', async (arg: unknown) => {
      const resolvedArg = requireDeploymentArg(arg, 'Redeploying a deployment');
      if (!resolvedArg) return;
      const context = requireDeploymentContext(resolvedArg);
      if (!context) return;
      await runQueuedDeploymentAction(
        resolvedArg.serverKey,
        `Redeploying ${context.deployment.deployName}...`,
        () => lifecycle.enqueueDeployFull(resolvedArg.serverKey, resolvedArg.deploymentId),
        `Redeploy completed for "${context.deployment.deployName}".`,
      );
    }],

    // §8.2 — jsm.deployment.undeploy
    ['jsm.deployment.undeploy', async (arg: unknown) => {
      const resolvedArg = requireDeploymentArg(arg, 'Undeploying a deployment');
      if (!resolvedArg) return;
      const context = requireDeploymentContext(resolvedArg);
      if (!context) return;
      await runQueuedDeploymentAction(
        resolvedArg.serverKey,
        `Undeploying ${context.deployment.deployName}...`,
        () => lifecycle.enqueueUndeploy(resolvedArg.serverKey, resolvedArg.deploymentId),
        `Undeployed "${context.deployment.deployName}".`,
      );
    }],

    // §8.2 — jsm.deployment.toggleAutosync
    ['jsm.deployment.toggleAutosync', async (arg: unknown) => {
      const resolvedArg = requireDeploymentArg(arg, 'Toggling AutoSync');
      if (!resolvedArg) return;
      const context = requireDeploymentContext(resolvedArg);
      if (!context) return;

      const newMode = nextSyncMode(context.deployment.syncMode);
      const updatedDep = { ...context.deployment, syncMode: newMode };
      const updatedServer = replaceDeployment(context.server, resolvedArg.deploymentId, updatedDep);

      const result = await updateServerConfig(resolvedArg.workspaceFolderUri, resolvedArg.serverId, updatedServer);
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }

      showSuccess(`AutoSync for "${context.deployment.deployName}" set to "${newMode}".`);
      treeProvider.requestRefresh();
    }],

    // §8.2 — jsm.deployment.configureIgnoreGlobs (deferred-v1.1)
    ['jsm.deployment.configureIgnoreGlobs', deferredStub('Configure Ignore Globs')],

    // §8.2 — jsm.deployment.edit
    ['jsm.deployment.edit', async (arg: unknown) => {
      const spaArg = asDeploymentDraftCommandArg(arg);
      if (spaArg) {
        return persistEditedDeployment(spaArg);
      }

      const resolvedArg = requireDeploymentArg(arg, 'Editing a deployment');
      if (!resolvedArg) return;
      openDeploymentDashboard(resolvedArg, 'edit');
      return undefined;
    }],

    // §8.2 — jsm.deployment.remove
    ['jsm.deployment.remove', async (arg: unknown) => {
      const resolvedArg = requireDeploymentArg(arg, 'Removing a deployment');
      if (!resolvedArg) return;
      const context = requireDeploymentContext(resolvedArg, { allowInlineDeployment: true });
      if (!context) {
        return;
      }
      const answer = await vscode.window.showWarningMessage(
        `Remove deployment "${context.deployment.deployName}"? This cannot be undone.`,
        { modal: true },
        'Remove',
      );
      if (answer !== 'Remove') return;

      const result = workspaceRegistry
        ? await workspaceRegistry.removeDeployment({
          workspaceFolderUri: resolvedArg.workspaceFolderUri,
          serverId: resolvedArg.serverId,
        }, resolvedArg.deploymentId)
        : await configService?.removeDeployment(resolvedArg.serverId, resolvedArg.deploymentId);
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Deployment "${context.deployment.deployName}" removed.`);
      treeProvider.requestRefresh();
    }],

    // Reveal deployment source in OS explorer / VS Code explorer (spec §17.3 download/export slot).
    ['jsm.deployment.revealSource', async (arg: unknown) => {
      const resolvedArg = requireDeploymentArg(arg, 'Revealing deployment source');
      if (!resolvedArg) return;
      const context = requireDeploymentContext(resolvedArg, { allowInlineDeployment: true });
      if (!context) return;
      const raw = context?.deployment.sourcePath.trim() ?? '';
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
      const resolvedArg = requireDeploymentArg(arg, 'Opening deployment logs');
      if (!resolvedArg) return;

      const { server } = resolveDeployment(resolvedArg);
      if (!server) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `Server not found for deployment.`,
          details: `workspaceFolderUri=${resolvedArg.workspaceFolderUri}, serverId=${resolvedArg.serverId}`,
        }));
        return;
      }

      const plugin = pluginRegistry.get(server.type);
      if (!plugin) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `No plugin registered for server type '${server.type}'.`,
        }));
        return;
      }

      const sourcesResult = await plugin.getLogSources(server);
      if (!sourcesResult.ok) {
        showErr(sourcesResult.error);
        return;
      }

      const files = collectFileLogPaths(sourcesResult.value);
      if (files.length === 0) {
        await vscode.window.showInformationMessage(
          `No file log sources are available for server "${server.name}".`,
        );
        return;
      }

      const pickedPath = await pickLogFilePath(files);
      if (!pickedPath) return;

      const openResult = await openLogFileSafely(pickedPath);
      if (!openResult.ok) {
        showErr(openResult.error);
      }
    }],
  ]);
}

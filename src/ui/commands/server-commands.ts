import * as path from 'path';
import * as vscode from 'vscode';
import {
  serverDraftToCreateServerRequest,
} from '@core/authoring';
import type { ServerAuthoringDraft } from '@core/authoring';
import type { ServerConfig } from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';
import { makeWorkspaceServerKey, type WorkspaceServiceRegistry, type WorkspaceScope } from '@app/config';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { ConfigSource } from '@plugins/interfaces/IServerPlugin';
import type { SchemaValidator } from '@core/validation/SchemaValidator';
import { exists } from '@infra/fs';
import type { ServerTreeViewProvider } from '@ui/tree/ServerTreeViewProvider';
import {
  isServerNode,
  registerMany,
  runUntilQueueIdleWithProgressResult,
  showErr,
  showSuccess,
} from './shared';
import * as fs from 'fs/promises';
import type { ServerLogChannel } from '@ui/channels/ServerLogChannel';

type ServerCommandArg = {
  serverId: string;
  workspaceFolderUri: string;
  serverKey?: string;
  serverConfig?: ServerConfig;
};

export interface ServerCommandsDeps {
  lifecycle: ServerLifecycle;
  pluginRegistry: PluginRegistry;
  logChannel: ServerLogChannel;
  workspaceRegistry?: WorkspaceServiceRegistry;
  configService?: {
    getServer(serverId: string): ServerConfig | undefined;
    reload(): Promise<Result<unknown, JsmError>>;
  };
  provisioningService?: {
    removeServer(serverId: string): Promise<Result<void, JsmError>>;
  };
  discoveryService?: ServerDiscoveryService;
  treeProvider: ServerTreeViewProvider;
  schemaValidator?: SchemaValidator;
}

async function pickWorkspaceScope(scopes: WorkspaceScope[]): Promise<WorkspaceScope | undefined> {
  if (scopes.length === 0) return undefined;
  if (scopes.length === 1) return scopes[0];

  return vscode.window.showQuickPick(
    scopes.map(scope => ({
      label: scope.name,
      description: scope.fsPath,
      scope,
    })),
    {
      placeHolder: 'Select the workspace folder that will own this server',
      ignoreFocusOut: true,
    },
  ).then(selection => selection?.scope);
}

async function revealFolder(targetPath: string): Promise<void> {
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
}

async function openConfigFile(targetPath: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function resolveConfigSources(
  pluginRegistry: PluginRegistry,
  config: ServerConfig,
): Promise<Result<ConfigSource[], JsmError>> {
  const plugin = pluginRegistry.get(config.type);
  if (!plugin) {
    return err(new JsmError({
      code: ErrorCode.InvalidConfig,
      message: `No plugin registered for server type '${config.type}'.`,
    }));
  }

  if (!plugin.getConfigSources) {
    return ok([]);
  }

  return plugin.getConfigSources(config);
}

export function registerServerCommands(
  deps: ServerCommandsDeps,
): vscode.Disposable[] {
  const {
    lifecycle,
    pluginRegistry,
    logChannel,
    workspaceRegistry,
    configService,
    provisioningService,
    treeProvider,
    schemaValidator,
  } = deps;

  const resolveServer = (workspaceFolderUri: string, serverId: string) => workspaceRegistry
    ? workspaceRegistry.getServer({ workspaceFolderUri, serverId })
    : configService?.getServer(serverId);

  function serverDisplayName(arg: ServerCommandArg): string {
    return arg.serverConfig?.name ?? resolveServer(arg.workspaceFolderUri, arg.serverId)?.name ?? arg.serverId;
  }

  function serverKeyResolved(arg: ServerCommandArg): string {
    if (typeof arg.serverKey === 'string' && arg.serverKey.length > 0) {
      return arg.serverKey;
    }
    if (workspaceRegistry) {
      return makeWorkspaceServerKey(arg.workspaceFolderUri, arg.serverId);
    }
    return arg.serverId;
  }

  return registerMany([
    ['jsm.server.add', async (arg: unknown) => {
      if (arg && typeof arg === 'object' && 'workspaceFolderUri' in arg) {
        const draftArg = arg as { draft?: unknown; workspaceFolderUri: string };
        if (!workspaceRegistry) {
          return { ok: false, message: 'Workspace registry not available' };
        }
        const entry = workspaceRegistry.getEntry(draftArg.workspaceFolderUri);
        if (!entry) {
          return { ok: false, message: 'Workspace not found.' };
        }

        const request = draftArg.draft && typeof draftArg.draft === 'object'
          ? serverDraftToCreateServerRequest(draftArg.draft as ServerAuthoringDraft)
          : undefined;
        if (!request) {
          return { ok: false, message: 'Invalid server draft payload.' };
        }

        const result = await entry.provisioningService.createServer(request);
        if (!result.ok) {
          return { ok: false, message: result.error.message };
        }

        treeProvider.requestRefresh();
        return {
          ok: true,
          message: `Server "${result.value.name}" created.`,
          data: {
            serverId: result.value.id,
            workspaceFolderUri: draftArg.workspaceFolderUri,
          },
        };
      }
      
      void vscode.commands.executeCommand('jsm.dashboard.open', { type: 'new-server', globalTab: 'home' });
      return undefined;
    }],

    ['jsm.server.startRun', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const sk = serverKeyResolved(a);
      const label = serverDisplayName(a);
      const config = resolveServer(a.workspaceFolderUri, a.serverId);
      if (config?.deployments?.length) {
        const prep = lifecycle.enqueueDeployUndeployed(sk);
        if (!prep.ok) {
          showErr(prep.error);
          return;
        }
        const prepDone = await runUntilQueueIdleWithProgressResult(
          { title: `Preparing deployments for ${label}...`, serverKey: sk },
          lifecycle,
        );
        if (!prepDone.ok) {
          showErr(prepDone.error);
          return;
        }
      }
      const result = lifecycle.start(sk, 'run');
      if (!result.ok) {
        showErr(result.error);
        return;
      }
      const startDone = await runUntilQueueIdleWithProgressResult(
        { title: `Starting ${label}...`, serverKey: sk },
        lifecycle,
      );
      if (!startDone.ok) showErr(startDone.error);
    }],

    ['jsm.server.startDebug', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const sk = serverKeyResolved(a);
      const label = serverDisplayName(a);
      const config = resolveServer(a.workspaceFolderUri, a.serverId);
      if (config?.deployments?.length) {
        const prep = lifecycle.enqueueDeployUndeployed(sk);
        if (!prep.ok) {
          showErr(prep.error);
          return;
        }
        const prepDone = await runUntilQueueIdleWithProgressResult(
          { title: `Preparing deployments for ${label}...`, serverKey: sk },
          lifecycle,
        );
        if (!prepDone.ok) {
          showErr(prepDone.error);
          return;
        }
      }
      const result = lifecycle.start(sk, 'debug');
      if (!result.ok) {
        showErr(result.error);
        return;
      }
      const startDone = await runUntilQueueIdleWithProgressResult(
        { title: `Starting ${label} (debug)...`, serverKey: sk },
        lifecycle,
      );
      if (!startDone.ok) showErr(startDone.error);
    }],

    ['jsm.server.stop', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const sk = serverKeyResolved(a);
      const result = lifecycle.stop(sk);
      if (!result.ok) {
        showErr(result.error);
        return;
      }
      const done = await runUntilQueueIdleWithProgressResult(
        { title: `Stopping ${serverDisplayName(a)}...`, serverKey: sk },
        lifecycle,
      );
      if (!done.ok) showErr(done.error);
    }],

    ['jsm.server.restartRun', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const sk = serverKeyResolved(a);
      const result = lifecycle.restart(sk, 'run');
      if (!result.ok) {
        showErr(result.error);
        return;
      }
      const done = await runUntilQueueIdleWithProgressResult(
        { title: `Restarting ${serverDisplayName(a)}...`, serverKey: sk },
        lifecycle,
      );
      if (!done.ok) showErr(done.error);
    }],

    ['jsm.server.restartDebug', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const sk = serverKeyResolved(a);
      const result = lifecycle.restart(sk, 'debug');
      if (!result.ok) {
        showErr(result.error);
        return;
      }
      const done = await runUntilQueueIdleWithProgressResult(
        { title: `Restarting ${serverDisplayName(a)} (debug)...`, serverKey: sk },
        lifecycle,
      );
      if (!done.ok) showErr(done.error);
    }],

    ['jsm.server.attachDebug', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const result = await lifecycle.attachDebug(serverKeyResolved(a));
      if (!result.ok) showErr(result.error);
      else showSuccess('Debugger attached.');
    }],

    ['jsm.server.detachDebug', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const result = await lifecycle.detachDebug(serverKeyResolved(a));
      if (!result.ok) showErr(result.error);
      else showSuccess('Debugger detached.');
    }],

    ['jsm.server.cancelOperation', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      lifecycle.cancel(serverKeyResolved(arg as ServerCommandArg));
    }],

    ['jsm.server.showLogs', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const sk = serverKeyResolved(a);
      logChannel.showLogs(sk, serverDisplayName(a));
    }],

    ['jsm.server.edit', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      vscode.commands.executeCommand('jsm.dashboard.open', {
        type: 'server',
        id: arg.serverId,
        globalTab: 'home',
      });
    }],

    ['jsm.server.duplicate', async (arg: unknown) => {
      if (!isServerNode(arg)) return;

      if (!workspaceRegistry) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Duplicate server is only available when using workspace registry.',
        }));
        return;
      }

      const entry = workspaceRegistry.getEntry(arg.workspaceFolderUri);
      if (!entry) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Workspace not found.',
          details: arg.workspaceFolderUri,
        }));
        return;
      }

      const sourceConfig = resolveServer(arg.workspaceFolderUri, arg.serverId) ?? arg.serverConfig;
      if (!sourceConfig) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Server configuration not found.',
        }));
        return;
      }

      const result = await entry.provisioningService.duplicateServer(sourceConfig);
      if (!result.ok) {
        showErr(result.error);
        return;
      }
      showSuccess(`Server "${result.value.name}" added with its own instance.`);
      treeProvider.requestRefresh();
    }],

    ['jsm.server.remove', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const label = serverDisplayName(a);
      const answer = await vscode.window.showWarningMessage(
        `Remove server "${label}"? This cannot be undone.`,
        { modal: true },
        'Remove',
      );
      if (answer !== 'Remove') return;

      const result = workspaceRegistry
        ? await workspaceRegistry.getEntry(a.workspaceFolderUri)?.provisioningService.removeServer(a.serverId)
        : await provisioningService?.removeServer(a.serverId);
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Server "${label}" removed.`);
      treeProvider.requestRefresh();
    }],

    ['jsm.server.openFolder', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const config = resolveServer(a.workspaceFolderUri, a.serverId) ?? a.serverConfig;
      if (!config) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Server configuration not found.',
        }));
        return;
      }

      const configuredPath = config.instancePath.trim();
      if (!configuredPath) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `Folder path is missing for server '${config.name}'.`,
        }));
        return;
      }

      if (await exists(configuredPath)) {
        await revealFolder(configuredPath);
        return;
      }

      const fallbackPath = path.dirname(configuredPath);
      if (fallbackPath && fallbackPath !== configuredPath && await exists(fallbackPath)) {
        await revealFolder(fallbackPath);
        return;
      }

      showErr(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `Folder is not accessible for server '${config.name}'.`,
        details: configuredPath,
      }));
    }],

    ['jsm.server.openConfig', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const config = resolveServer(a.workspaceFolderUri, a.serverId) ?? a.serverConfig;
      if (!config) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Server configuration not found.',
        }));
        return;
      }

      const sourcesResult = await resolveConfigSources(pluginRegistry, config);
      if (!sourcesResult.ok) {
        showErr(sourcesResult.error);
        return;
      }

      const candidates = sourcesResult.value;
      if (candidates.length === 0) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `No editable configuration files were found for server '${config.name}'.`,
          details: `The '${config.type}' plugin did not expose any existing config files for this server.`,
        }));
        return;
      }

      if (candidates.length === 1) {
        await openConfigFile(candidates[0].path);
        return;
      }

      const picked = await vscode.window.showQuickPick(
        candidates.map(candidate => ({
          label: candidate.title,
          description: candidate.description,
          detail: candidate.path,
          candidate,
        })),
        {
          placeHolder: `Open a configuration file for '${config.name}'`,
          ignoreFocusOut: true,
        },
      );

      if (!picked) {
        return;
      }

      await openConfigFile(picked.candidate.path);
    }],

    ['jsm.server.redeployAll', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const a = arg as ServerCommandArg;
      const sk = serverKeyResolved(a);
      const config = resolveServer(a.workspaceFolderUri, a.serverId) ?? a.serverConfig;
      if (!config || config.deployments.length === 0) return;
      const enq = lifecycle.enqueueRedeployAll(sk);
      if (!enq.ok) {
        showErr(enq.error);
        return;
      }
      const done = await runUntilQueueIdleWithProgressResult(
        { title: `Redeploying all applications on ${config.name}...`, serverKey: sk },
        lifecycle,
      );
      if (!done.ok) {
        showErr(done.error);
        return;
      }
      showSuccess(`Redeploy All completed for "${config.name}".`);
    }],

    ['jsm.view.refresh', async () => {
      const result = workspaceRegistry
        ? await workspaceRegistry.reloadAll()
        : await configService?.reload();
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      for (const serverKey of lifecycle.getServerKeysInState('running', 'starting')) {
        lifecycle.refreshStatus(serverKey);
      }
      if (workspaceRegistry) {
        const keys = lifecycle.getServerKeysInState('running', 'starting');
        await Promise.all(
          keys.map(async serverKey => {
            const record = workspaceRegistry.getServerRecordByKey(serverKey);
            if (!record?.config) return;
            const enq = lifecycle.enqueueRunDeploymentHealthChecks(serverKey);
            if (!enq.ok) return;
            await lifecycle.waitUntilQueueIdle(serverKey);
          }),
        );
      }
      treeProvider.forceRefresh();
    }],

    ['jsm.server.export', async () => {
      if (!workspaceRegistry) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Export is only available when using workspace registry.',
        }));
        return;
      }
      const scope = await pickWorkspaceScope(workspaceRegistry.getWorkspaceScopes());
      if (!scope) return;
      const records = workspaceRegistry.getServers(scope.uri);
      const configs = records.map(r => r.config);
      if (configs.length === 0) {
        void vscode.window.showInformationMessage('JSM: No servers to export in this workspace.');
        return;
      }
      const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      const saveUri = await vscode.window.showSaveDialog({
        filters: { JSON: ['json'] },
        defaultUri: defaultUri ? vscode.Uri.joinPath(defaultUri, 'jsm.servers.export.json') : undefined,
      });
      if (!saveUri) return;
      try {
        await fs.writeFile(saveUri.fsPath, JSON.stringify({ servers: configs }, null, 2), 'utf8');
        showSuccess(`Config exported to ${saveUri.fsPath}.`);
      } catch (e) {
        showErr(JsmError.fromUnknown(e));
      }
    }],

    ['jsm.server.import', async () => {
      if (!workspaceRegistry) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Import is only available when using workspace registry.',
        }));
        return;
      }
      if (!schemaValidator) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Import requires schema validator.',
        }));
        return;
      }
      const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        filters: { JSON: ['json'] },
        defaultUri: defaultUri ?? undefined,
      });
      if (!uris?.length) return;
      const fileUri = uris[0];
      let content: string;
      try {
        content = await fs.readFile(fileUri.fsPath, 'utf8');
      } catch (e) {
        showErr(JsmError.fromUnknown(e));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Invalid JSON.',
        }));
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { servers?: unknown }).servers)) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Invalid format: expected { servers: [...] }.',
        }));
        return;
      }
      const validationResult = schemaValidator.validate(parsed, 'workspace');
      if (!validationResult.ok) {
        showErr(validationResult.error);
        return;
      }
      const { servers: serverConfigs } = parsed as { servers: ServerConfig[] };
      if (serverConfigs.length === 0) {
        void vscode.window.showInformationMessage('JSM: No servers in file.');
        return;
      }
      const scope = await pickWorkspaceScope(workspaceRegistry.getWorkspaceScopes());
      if (!scope) return;
      const entry = workspaceRegistry.getEntry(scope.uri);
      if (!entry) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'Workspace not found.',
        }));
        return;
      }
      let imported = 0;
      for (const serverConfig of serverConfigs) {
        const result = await entry.provisioningService.duplicateServer(serverConfig, { keepName: true });
        if (!result.ok) {
          showErr(result.error);
          break;
        }
        imported += 1;
      }
      if (imported > 0) {
        showSuccess(`Imported ${imported} server(s) into workspace "${scope.name}".`);
        treeProvider.requestRefresh();
      }
    }],
  ]);
}

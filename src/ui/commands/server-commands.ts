import * as path from 'path';
import * as vscode from 'vscode';
import type { OperationContext, ServerConfig } from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';
import type { DeploymentService } from '@app/deployment/DeploymentService';
import type { WorkspaceServiceRegistry, WorkspaceScope } from '@app/config';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { ConfigSource } from '@plugins/interfaces/IServerPlugin';
import type { SchemaValidator } from '@core/validation/SchemaValidator';
import { exists } from '@infra/fs';
import type { ServerTreeViewProvider } from '@ui/tree/ServerTreeViewProvider';
import type { ServerFormPanel } from '@ui/webviews/panels/ServerFormPanel';
import {
  isServerNode,
  registerMany,
  showErr,
  showSuccess,
} from './shared';
import * as fs from 'fs/promises';

export interface ServerCommandsDeps {
  lifecycle: ServerLifecycle;
  pluginRegistry: PluginRegistry;
  workspaceRegistry?: WorkspaceServiceRegistry;
  configService?: {
    getServer(serverId: string): ServerConfig | undefined;
    reload(): Promise<Result<unknown, JsmError>>;
  };
  provisioningService?: {
    removeServer(serverId: string): Promise<Result<void, JsmError>>;
  };
  deployService: DeploymentService;
  discoveryService?: ServerDiscoveryService;
  treeProvider: ServerTreeViewProvider;
  schemaValidator?: SchemaValidator;
  serverFormPanel: ServerFormPanel | {
    open?(mode: 'create' | 'edit', serverId?: string): void;
    openCreate?(workspaceFolderUri: string, initialData?: Record<string, unknown>): void;
    openEdit?(locator: { workspaceFolderUri: string; serverId: string }): void;
  };
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

function makeOpCtx(serverId: string, kind: OperationContext['kind']): OperationContext {
  return {
    operationId: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    serverId,
    kind,
    startedAt: Date.now(),
    timeoutMs: 60_000,
    cancel: { isCancelled: false, onCancelled: () => ({ dispose: () => {} }) },
    progress: { report: () => {} },
    output: { append: () => {}, appendLine: () => {}, clear: () => {} },
  };
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
    workspaceRegistry,
    configService,
    provisioningService,
    deployService,
    discoveryService,
    treeProvider,
    schemaValidator,
    serverFormPanel,
  } = deps;

  const resolveServer = (workspaceFolderUri: string, serverId: string) => workspaceRegistry
    ? workspaceRegistry.getServer({ workspaceFolderUri, serverId })
    : configService?.getServer(serverId);

  return registerMany([
    ['jsm.server.add', async () => {
      if (!workspaceRegistry) {
        serverFormPanel.open?.('create');
        return;
      }

      const scope = await pickWorkspaceScope(workspaceRegistry.getWorkspaceScopes());
      if (!scope) return;
      if (serverFormPanel.openCreate) {
        serverFormPanel.openCreate(scope.uri);
        return;
      }
      serverFormPanel.open?.('create');
    }],

    ['jsm.server.autodiscover', async () => {
      if (!discoveryService) {
        showErr(new JsmError({
          code: ErrorCode.Unsupported,
          message: 'Autodiscovery is not available in this environment.',
        }));
        return;
      }

      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Discovering Java servers...',
        cancellable: false,
      }, async () => {
        const folders = workspaceRegistry?.getWorkspaceScopes().map(s => s.fsPath) ?? [];
        const results = await discoveryService.discover(folders);

        // Filter out already registered servers
        const registeredHomes = new Set<string>();
        if (workspaceRegistry) {
          for (const server of workspaceRegistry.getAllServers()) {
            registeredHomes.add(server.config.runtime.homePath);
          }
        }
        
        const newServers = results.filter(r => !registeredHomes.has(r.path));

        if (newServers.length === 0) {
          vscode.window.showInformationMessage('No unmanaged Java servers found in common locations.');
          return;
        }

        const items: vscode.QuickPickItem[] = newServers.map(s => ({
          label: `$(server) ${s.type.charAt(0).toUpperCase() + s.type.slice(1)} ${s.version ?? ''}`,
          description: s.path,
          detail: `Found in ${s.source === 'env' ? 'environment variables' : s.source === 'workspace' ? 'workspace' : 'OS common paths'}`,
        }));

        const selection = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a discovered server to register',
        });

        if (!selection) return;

        const selectedPath = selection.description!;
        const selectedType = newServers.find(s => s.path === selectedPath)?.type;

        // Same flow as add: pick workspace scope, then open panel
        if (!workspaceRegistry) {
          serverFormPanel.open?.('create');
          return;
        }

        const scope = await pickWorkspaceScope(workspaceRegistry.getWorkspaceScopes());
        if (!scope) return;

        if (serverFormPanel.openCreate) {
          // Pre-fill the form using initial data (flat paths like 'runtime.homePath')
          serverFormPanel.openCreate(scope.uri, {
            name: `${selection.label.replace('$(server) ', '')}`,
            type: selectedType,
            'runtime.homePath': selectedPath,
          });
        }
      });
    }],

    ['jsm.server.startRun', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      if (config?.deployments?.length) {
        try {
          const ctx = makeOpCtx(arg.serverKey, 'RedeployAll');
          await deployService.deployUndeployed(ctx, config);
        } catch (e) {
          showErr(JsmError.fromUnknown(e));
          return;
        }
      }
      const result = lifecycle.start(arg.serverKey, 'run');
      if (!result.ok) showErr(result.error);
    }],

    ['jsm.server.startDebug', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      if (config?.deployments?.length) {
        try {
          const ctx = makeOpCtx(arg.serverKey, 'RedeployAll');
          await deployService.deployUndeployed(ctx, config);
        } catch (e) {
          showErr(JsmError.fromUnknown(e));
          return;
        }
      }
      const result = lifecycle.start(arg.serverKey, 'debug');
      if (!result.ok) showErr(result.error);
    }],

    ['jsm.server.stop', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.stop(arg.serverKey);
      if (!result.ok) showErr(result.error);
    }],

    ['jsm.server.restartRun', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.restart(arg.serverKey, 'run');
      if (!result.ok) showErr(result.error);
    }],

    ['jsm.server.restartDebug', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = lifecycle.restart(arg.serverKey, 'debug');
      if (!result.ok) showErr(result.error);
    }],

    ['jsm.server.attachDebug', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = await lifecycle.attachDebug(arg.serverKey);
      if (!result.ok) showErr(result.error);
      else showSuccess('Debugger attached.');
    }],

    ['jsm.server.detachDebug', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const result = await lifecycle.detachDebug(arg.serverKey);
      if (!result.ok) showErr(result.error);
      else showSuccess('Debugger detached.');
    }],

    ['jsm.server.cancelOperation', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      lifecycle.cancel(arg.serverKey);
    }],

    ['jsm.server.edit', (arg: unknown) => {
      if (!isServerNode(arg)) return;
      if (serverFormPanel.openEdit) {
        serverFormPanel.openEdit({
          workspaceFolderUri: arg.workspaceFolderUri,
          serverId: arg.serverId,
        });
        return;
      }
      serverFormPanel.open?.('edit', arg.serverId);
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

      const result = await entry.provisioningService.duplicateServer(arg.serverConfig);
      if (!result.ok) {
        showErr(result.error);
        return;
      }
      showSuccess(`Server "${result.value.name}" added with its own instance.`);
      treeProvider.requestRefresh();
    }],

    ['jsm.server.remove', async (arg: unknown) => {
      if (!isServerNode(arg)) return;
      const answer = await vscode.window.showWarningMessage(
        `Remove server "${arg.serverConfig.name}"? This cannot be undone.`,
        { modal: true },
        'Remove',
      );
      if (answer !== 'Remove') return;

      const result = workspaceRegistry
        ? await workspaceRegistry.getEntry(arg.workspaceFolderUri)?.provisioningService.removeServer(arg.serverId)
        : await provisioningService?.removeServer(arg.serverId);
      if (!result) return;
      if (!result.ok) { showErr(result.error); return; }
      showSuccess(`Server "${arg.serverConfig.name}" removed.`);
      treeProvider.requestRefresh();
    }],

    ['jsm.server.openFolder', async (arg: unknown) => {
      if (!isServerNode(arg)) return;

      const configuredPath = arg.serverConfig.instancePath.trim();
      if (!configuredPath) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `Folder path is missing for server '${arg.serverConfig.name}'.`,
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
        message: `Folder is not accessible for server '${arg.serverConfig.name}'.`,
        details: configuredPath,
      }));
    }],

    ['jsm.server.openConfig', async (arg: unknown) => {
      if (!isServerNode(arg)) return;

      const sourcesResult = await resolveConfigSources(pluginRegistry, arg.serverConfig);
      if (!sourcesResult.ok) {
        showErr(sourcesResult.error);
        return;
      }

      const candidates = sourcesResult.value;
      if (candidates.length === 0) {
        showErr(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `No editable configuration files were found for server '${arg.serverConfig.name}'.`,
          details: `The '${arg.serverConfig.type}' plugin did not expose any existing config files for this server.`,
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
          placeHolder: `Open a configuration file for '${arg.serverConfig.name}'`,
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
      const config = resolveServer(arg.workspaceFolderUri, arg.serverId);
      if (!config || config.deployments.length === 0) return;
      const ctx = makeOpCtx(arg.serverKey, 'RedeployAll');
      await deployService.redeployAll(ctx, config);
      showSuccess(`Redeploy All completed for "${arg.serverConfig.name}".`);
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
        for (const serverKey of lifecycle.getServerKeysInState('running', 'starting')) {
          const record = workspaceRegistry.getServerRecordByKey(serverKey);
          if (record?.config) {
            await deployService.runHealthChecksForServer(serverKey, record.config);
          }
        }
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

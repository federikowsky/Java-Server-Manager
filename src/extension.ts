import * as vscode from 'vscode';
import * as path from 'path';
import { createHash } from 'crypto';
import workspaceSchemaDocument from './schema/jsm.servers.schema.json';
import type { ServerId, DeploymentId, FileChangeBatch, Logger as ILogger } from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { EventBus } from '@core/events/EventBus';
import { OperationQueue } from '@core/ops/OperationQueue';
import { SchemaValidator } from '@core/validation/SchemaValidator';
import { Logger, RingBuffer } from '@infra/logging';
import { ConfigRepo } from '@infra/fs';
import { ProcessSpawner } from '@infra/process';
import { PortScanner } from '@infra/ports';
import { PidManager } from '@infra/pid';
import { PluginRegistry } from '@plugins/registry/PluginRegistry';
import { TomcatPlugin } from '@plugins/tomcat/TomcatPlugin';
import {
  ConfigService,
  WorkspaceServiceRegistry,
  makeWorkspaceServerKey,
  type WorkspaceServiceEntry,
} from '@app/config';
import { ServerLifecycle } from '@app/server';
import { ManagedInstancePathResolver, ServerProvisioningService, ServerDiscoveryService } from '@app/server';
import { DeploymentService } from '@app/deployment';
import { AutoSyncService } from '@app/sync';
import { TemplateService } from '@app/templates';
import { HookRunner } from '@app/hooks';
import type { HookExecutor } from '@app/hooks';
import { OutputSinkAdapter, MementoAdapter, DebugAdapter, FileWatcherAdapter } from '@ui/adapters';
import { ServerLogChannel } from '@ui/channels';
import { ServerTreeViewProvider } from '@ui/tree';
import { DashboardPanel } from '@ui/webviews/panels/DashboardPanel';
import { registerServerCommands, registerDeploymentCommands } from '@ui/commands';
import {
  MAIN_OUTPUT_CHANNEL,
  VIEW_ID,
  WORKSPACE_CONFIG_DIR,
} from './constants';

// ── Disposables ─────────────────────────────────────────────────────────────

const disposables: vscode.Disposable[] = [];

function workspaceStorageId(workspaceFolderUri: string): string {
  return createHash('sha1').update(workspaceFolderUri).digest('hex').slice(0, 12);
}

function workspaceFolderUriString(folder: vscode.WorkspaceFolder): string {
  const uri = folder.uri as { toString?: () => string; fsPath?: string };
  return typeof uri?.toString === 'function' ? uri.toString() : uri?.fsPath ?? '';
}

// ── Activate ────────────────────────────────────────────────────────────────

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    // No workspace — nothing to manage
    return;
  }

  const primaryWorkspaceFolder = workspaceFolders[0].uri.fsPath;

  // ── 1. Infra layer ──────────────────────────────────────────────────────

  const outputChannel = vscode.window.createOutputChannel(MAIN_OUTPUT_CHANNEL, { log: true });
  disposables.push(outputChannel);
  const outputSink = new OutputSinkAdapter(outputChannel);

  const ringBuffer = new RingBuffer();
  const logger = new Logger({ scope: 'JSM', sink: outputSink }, ringBuffer);

  const globalStore = new MementoAdapter(ctx.globalState);
  const workspaceStore = new MementoAdapter(ctx.workspaceState);
  const processSpawner = new ProcessSpawner(logger);
  const portScanner = new PortScanner();
  const baseManagedStorageRoot = ctx.storageUri?.fsPath
    ?? path.join(primaryWorkspaceFolder, WORKSPACE_CONFIG_DIR, 'jsm-managed-storage');
  const pidManager = new PidManager(path.join(baseManagedStorageRoot, 'pids'), logger);

  // ── 2. Core layer ──────────────────────────────────────────────────────

  const eventBus = new EventBus(logger);
  disposables.push(eventBus);

  const opQueueFactory = (serverId: ServerId): OperationQueue =>
    new OperationQueue(serverId, logger);

  const validator = new SchemaValidator();
  validator.registerBuiltInSchemas(workspaceSchemaDocument as Record<string, unknown> & {
    definitions?: Record<string, unknown>;
  });

  // ── 3. Plugins layer ──────────────────────────────────────────────────

  const pluginRegistry = new PluginRegistry(logger);
  pluginRegistry.register('tomcat', (l: ILogger) => new TomcatPlugin(l, {
    startupListenerJarPath: path.join(ctx.extensionUri.fsPath, 'assets', 'tomcat', 'jsm-tomcat-startup-listener.jar'),
    serverXmlTemplatePath: path.join(ctx.extensionUri.fsPath, 'assets', 'tomcat', 'server.xml.template'),
    keyValueStore: workspaceStore,
  }));

  // ── 4. UI adapters (needed by app layer) ──────────────────────────────

  const debugAdapter = new DebugAdapter();
  disposables.push(debugAdapter.onDidChangeSession(({ serverId, attached }) => {
    const runtime = lifecycle.getRuntime(serverId);
    if (runtime) runtime.setDebugAttached(attached);
  }));
  const fileWatcherAdapter = new FileWatcherAdapter();
  const logChannel = new ServerLogChannel();
  disposables.push(logChannel);

  // ── 5. App layer ──────────────────────────────────────────────────────

  async function resolveHookTask(taskName: string): Promise<Result<vscode.Task, JsmError>> {
    const normalizedTaskName = taskName.trim();
    if (normalizedTaskName.length === 0) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: 'VS Code hook task name is required',
      }));
    }

    const tasks = await vscode.tasks.fetchTasks();
    const matches = tasks.filter(candidate => candidate.name.trim() === normalizedTaskName);

    if (matches.length === 0) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `VS Code task '${normalizedTaskName}' not found`,
      }));
    }

    if (matches.length > 1) {
      return err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: `VS Code task '${normalizedTaskName}' is ambiguous; use a unique task name`,
      }));
    }

    return ok(matches[0]);
  }

  const hookExecutor: HookExecutor = {
    async runCommand(request): Promise<Result<void, JsmError>> {
      try {
        const cmd = request.hook.command;
        if (!cmd) {
          return err(new JsmError({ code: ErrorCode.HookFailed, message: 'Hook has no command config' }));
        }
        const child = processSpawner.spawnShell({
          line: cmd.line,
          cwd: cmd.cwd ?? primaryWorkspaceFolder,
          env: cmd.env,
          onData: (chunk) => request.parent.output.append(chunk),
        });
        await new Promise<void>((resolve, reject) => {
          child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Hook exited with code ${code}`));
          });
          child.on('error', reject);
        });
        return ok(undefined);
      } catch (e) {
        return err(
          new JsmError({ code: ErrorCode.HookFailed, message: `Hook command failed: ${String(e)}` }),
        );
      }
    },
    async runVscodeTask(request): Promise<Result<void, JsmError>> {
      try {
        const taskName = request.hook.vscodeTask?.taskName ?? 'JSM Hook';
        const taskResult = await resolveHookTask(taskName);
        if (!taskResult.ok) {
          return taskResult;
        }

        request.parent.output.appendLine(`Starting VS Code task hook '${taskName}'`);
        const taskExecution = await vscode.tasks.executeTask(taskResult.value);
        const exitCode = await new Promise<number | undefined>((resolve) => {
          const d = vscode.tasks.onDidEndTaskProcess((ev) => {
            if (ev.execution === taskExecution) {
              d.dispose();
              resolve(ev.exitCode);
            }
          });
        });

        if (exitCode !== undefined && exitCode !== 0) {
          return err(new JsmError({
            code: ErrorCode.HookFailed,
            message: `VS Code task '${taskName}' failed with exit code ${exitCode}`,
          }));
        }

        request.parent.output.appendLine(`VS Code task hook '${taskName}' completed`);
        return ok(undefined);
      } catch (e) {
        return err(
          new JsmError({ code: ErrorCode.HookFailed, message: `VS Code task hook failed: ${String(e)}` }),
        );
      }
    },
  };

  // TrustGate (§12.8): injected into services that perform side-effecting operations
  const trustGate = { isTrusted: () => vscode.workspace.isTrusted };

  const hookRunner = new HookRunner({ executor: hookExecutor, logger, trustGate });

  function buildWorkspaceServiceEntry(folder: vscode.WorkspaceFolder): WorkspaceServiceEntry {
    const scopeUri = workspaceFolderUriString(folder);
    const scope = {
      uri: scopeUri,
      name: folder.name,
      fsPath: folder.uri.fsPath,
    };
    const configRepo = new ConfigRepo(folder.uri.fsPath, logger);
    const configService = new ConfigService({
      repo: configRepo,
      validator,
      bus: eventBus,
      logger,
      workspaceFolderUri: scope.uri,
      trustGate,
    });
    const managedInstancePathResolver = new ManagedInstancePathResolver(
      path.join(baseManagedStorageRoot, 'workspaces', workspaceStorageId(scope.uri), 'instances'),
    );
    const provisioningService = new ServerProvisioningService({
      configService,
      pluginRegistry,
      pathResolver: managedInstancePathResolver,
      logger,
      trustGate,
    });

    return {
      scope,
      configService,
      provisioningService,
      configFilePath: configRepo.filePath,
    };
  }

  const workspaceServiceRegistry = new WorkspaceServiceRegistry(
    workspaceFolders.map(buildWorkspaceServiceEntry),
    logger,
  );

  const deployService = new DeploymentService({
    pluginRegistry,
    bus: eventBus,
    logger,
    trustGate,
    hookRunner,
  });

  const autoSyncRef: { current?: InstanceType<typeof AutoSyncService> } = {};

  const lifecycle = new ServerLifecycle({
    pluginRegistry,
    bus: eventBus,
    pidManager,
    portScanner,
    debugAttacher: debugAdapter,
    logger,
    trustGate,
    hookRunner,
    getOutputSink: (serverId, serverName) => ({
      append: (text: string) => {
        logChannel.getChannel(serverId, serverName).append(text);
      },
      appendLine: (text: string) => {
        logChannel.appendLine(serverId, serverName, text);
      },
      clear: () => {
        logChannel.getChannel(serverId, serverName).clear();
      },
    }),
    deployService,
    resolveServerConfig: serverKey =>
      workspaceServiceRegistry.getServerRecordByKey(serverKey)?.config,
    onDeploySyncFailure: (serverKey, deploymentId) => {
      autoSyncRef.current?.recordFailure(serverKey, deploymentId);
    },
  });

  const autoSyncService = new AutoSyncService({
    bus: eventBus,
    watcherFactory: fileWatcherAdapter,
    logger,
    trustGate,
    onSyncRequest: async (
      serverId: ServerId,
      deploymentId: DeploymentId,
      batch: FileChangeBatch,
    ) => {
      if (!lifecycle.getRuntime(serverId)) return;
      const enqueued = lifecycle.enqueueDeploySync(serverId, deploymentId, batch);
      if (!enqueued.ok) {
        autoSyncRef.current?.recordFailure(serverId, deploymentId);
      }
    },
  });
  autoSyncRef.current = autoSyncService;
  disposables.push(autoSyncService);

  /** Recreate autosync watchers from latest saved config when the server is running. */
  function refreshAutosyncIfRunning(serverKey: ServerId): void {
    if (lifecycle.getRuntime(serverKey)?.getState().state !== 'running') return;
    const cfg = workspaceServiceRegistry.getServerRecordByKey(serverKey)?.config;
    if (!cfg) return;
    autoSyncService.rebindWatchers(serverKey, cfg);
  }

  async function loadAndRegisterServersForWorkspace(
    scopeUri: string,
    scopeNameForLog: string,
  ): Promise<Array<{ serverKey: ServerId; config: ReturnType<typeof workspaceServiceRegistry.getAllServers>[number]['config'] }>> {
    const entry = workspaceServiceRegistry.getEntry(scopeUri);
    if (!entry) {
      return [];
    }

    const loadResult = await entry.configService.loadWorkspace();
    if (!loadResult.ok) {
      logger.error(`Failed to load workspace config for '${scopeNameForLog}'`, loadResult.error);
      return [];
    }

    const out: Array<{ serverKey: ServerId; config: ReturnType<typeof workspaceServiceRegistry.getAllServers>[number]['config'] }> = [];
    for (const config of loadResult.value) {
      const serverKey = makeWorkspaceServerKey(scopeUri, config.id);
      const queue = opQueueFactory(serverKey);
      lifecycle.register(serverKey, config, queue);
      out.push({ serverKey, config });
    }
    return out;
  }

  function teardownWorkspaceFolder(scopeUri: string): void {
    const records = workspaceServiceRegistry.getServers(scopeUri);
    for (const record of records) {
      const { serverKey } = record;
      lifecycle.unregister(serverKey);
      logChannel.detach(serverKey);
      autoSyncService.purgeServerWatchState(serverKey);
    }
  }

  const templateService = new TemplateService({
    globalStore,
    workspaceStore,
    logger,
    trustGate,
  });

  const discoveryService = new ServerDiscoveryService(pluginRegistry, logger);

  // ── 6. UI presentation ────────────────────────────────────────────────

  const treeProvider = new ServerTreeViewProvider({
    getWorkspaceFolders: () => workspaceServiceRegistry.getWorkspaceScopes().map(scope => ({
      workspaceFolderUri: scope.uri,
      workspaceFolderName: scope.name,
    })),
    getServers: (workspaceFolderUri: string) => workspaceServiceRegistry.getServers(workspaceFolderUri),
    getRuntimeState: (sid: ServerId) => lifecycle.getRuntime(sid)?.getState(),
    isQueueBusy: (sid: ServerId) => lifecycle.isQueueBusy(sid),
    getDeploymentState: (sid: ServerId, did: DeploymentId) =>
      deployService.getDeploymentState(sid, did),
    getDeploymentHealth: (sid: ServerId, did: DeploymentId) =>
      deployService.getDeploymentHealth(sid, did),
  });

  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  disposables.push(treeView);

  disposables.push(
    eventBus.on('OperationStarted', () => {
      treeProvider.requestRefresh();
    }),
    eventBus.on('OperationCompleted', () => {
      treeProvider.requestRefresh();
    }),
    eventBus.on('OperationFailed', () => {
      treeProvider.requestRefresh();
    }),
  );

  const dashboardPanel = new DashboardPanel({
    extensionUri: ctx.extensionUri,
    workspaceRegistry: workspaceServiceRegistry,
    lifecycle,
    templateService,
    pluginRegistry,
    discoveryService,
    deployService,
    logger,
    bus: eventBus,
    trustGate,
  });
  disposables.push(dashboardPanel);

  // ── 7. Commands ───────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('jsm.dashboard.open', (target) => {
      dashboardPanel.show(target);
    }),
    ...registerServerCommands({
      lifecycle,
      pluginRegistry,
      logChannel,
      workspaceRegistry: workspaceServiceRegistry,
      discoveryService,
      treeProvider,
      schemaValidator: validator,
      openDashboard: target => dashboardPanel.show(target),
    }),
    ...registerDeploymentCommands({
      workspaceRegistry: workspaceServiceRegistry,
      pluginRegistry,
      lifecycle,
      treeProvider,
    }),
  );

  // ── 8. Event wiring ──────────────────────────────────────────────────

  disposables.push(
    eventBus.on('ServerAdded', ({ serverId, workspaceFolderUri }) => {
      const config = workspaceServiceRegistry.getServer({ workspaceFolderUri, serverId });
      if (config) {
        const serverKey = makeWorkspaceServerKey(workspaceFolderUri, serverId);
        const queue = opQueueFactory(serverKey);
        lifecycle.register(serverKey, config, queue);
      }
      treeProvider.requestRefresh();
    }),
    eventBus.on('ServerUpdated', ({ serverId, workspaceFolderUri }) => {
      const config = workspaceServiceRegistry.getServer({ workspaceFolderUri, serverId });
      const serverKey = makeWorkspaceServerKey(workspaceFolderUri, serverId);
      if (config) {
        lifecycle.updateConfig(serverKey, config);
        refreshAutosyncIfRunning(serverKey);
      }
      treeProvider.requestRefresh();
    }),
    eventBus.on('ServerDeleted', ({ serverId, workspaceFolderUri }) => {
      const serverKey = makeWorkspaceServerKey(workspaceFolderUri, serverId);
      lifecycle.unregister(serverKey);
      logChannel.detach(serverKey);
      autoSyncService.purgeServerWatchState(serverKey);
      treeProvider.requestRefresh();
    }),
    eventBus.on('DeploymentAdded', ({ serverId, workspaceFolderUri }) => {
      const config = workspaceServiceRegistry.getServer({ workspaceFolderUri, serverId });
      const serverKey = makeWorkspaceServerKey(workspaceFolderUri, serverId);
      if (config) {
        lifecycle.updateConfig(serverKey, config);
        refreshAutosyncIfRunning(serverKey);
      }
      treeProvider.requestRefresh();
    }),
    eventBus.on('DeploymentUpdated', ({ serverId, workspaceFolderUri }) => {
      const config = workspaceServiceRegistry.getServer({ workspaceFolderUri, serverId });
      const serverKey = makeWorkspaceServerKey(workspaceFolderUri, serverId);
      if (config) {
        lifecycle.updateConfig(serverKey, config);
        refreshAutosyncIfRunning(serverKey);
      }
      treeProvider.requestRefresh();
    }),
    eventBus.on('DeploymentRemoved', ({ serverId, workspaceFolderUri }) => {
      const config = workspaceServiceRegistry.getServer({ workspaceFolderUri, serverId });
      const serverKey = makeWorkspaceServerKey(workspaceFolderUri, serverId);
      if (config) {
        lifecycle.updateConfig(serverKey, config);
        refreshAutosyncIfRunning(serverKey);
      }
      treeProvider.requestRefresh();
    }),
    eventBus.on('ServerStateChanged', ({ serverId, state }) => {
      const record = workspaceServiceRegistry.getServerRecordByKey(serverId);
      const config = record?.config;
      const name = config?.name ?? serverId;

      if (state === 'starting') {
        const channel = logChannel.getChannel(serverId, name);
        channel.clear();
        logChannel.showLogs(serverId, name);
      } else if (state === 'running') {
        logChannel.showLogs(serverId, name);
        if (config) autoSyncService.rebindWatchers(serverId, config);
      } else if (state === 'stopped' || state === 'error') {
        autoSyncService.suspend(serverId);
        autoSyncService.disable(serverId);
      }

      treeProvider.requestRefresh();
    }),
    eventBus.on('ConfigChanged', () => {
      treeProvider.requestRefresh();
    }),
    eventBus.on('DeploymentStateChanged', () => {
      treeProvider.requestRefresh();
    }),
  );

  disposables.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
      for (const folder of e.removed) {
        const scopeUri = workspaceFolderUriString(folder);
        teardownWorkspaceFolder(scopeUri);
        workspaceServiceRegistry.removeEntry(scopeUri);
      }
      for (const folder of e.added) {
        const entry = buildWorkspaceServiceEntry(folder);
        workspaceServiceRegistry.registerEntry(entry);
        const loaded = await loadAndRegisterServersForWorkspace(entry.scope.uri, entry.scope.name);
        if (loaded.length > 0) {
          lifecycle.reconcileRunningServers(loaded).catch((err: unknown) => {
            logger.error('Reconciliation failed after workspace folder added', err);
          });
        }
      }
      if (e.removed.length > 0 || e.added.length > 0) {
        treeProvider.forceRefresh();
      }
    }),
  );

  // ── 9. Load workspace ────────────────────────────────────────────────

  const loadedServers: Array<{ serverKey: ServerId; config: ReturnType<typeof workspaceServiceRegistry.getAllServers>[number]['config'] }> = [];
  for (const scope of workspaceServiceRegistry.getWorkspaceScopes()) {
    const chunk = await loadAndRegisterServersForWorkspace(scope.uri, scope.name);
    loadedServers.push(...chunk);
  }

  treeProvider.forceRefresh();

  if (loadedServers.length > 0) {
    lifecycle.reconcileRunningServers(loadedServers).catch((e) => {
      logger.error('Reconciliation failed', e);
    });
  }

  // Push all to context subscriptions for cleanup
  ctx.subscriptions.push(...disposables);

  logger.info('Java Server Manager activated');
}

// ── Deactivate ──────────────────────────────────────────────────────────────

export function deactivate(): void {
  for (const d of disposables) {
    d.dispose();
  }
  disposables.length = 0;
}

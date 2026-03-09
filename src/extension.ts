import * as vscode from 'vscode';
import * as path from 'path';
import type { HookConfig, ServerId, DeploymentId, FileChangeBatch, OperationContext, Logger as ILogger } from '@core/types';
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
import { ConfigService } from '@app/config';
import { ServerLifecycle } from '@app/server';
import { DeploymentService } from '@app/deployment';
import { AutoSyncService } from '@app/sync';
import { TemplateService } from '@app/templates';
import { DiagnosticsService } from '@app/diagnostics';
import { HookRunner } from '@app/hooks';
import type { HookExecutor } from '@app/hooks';
import { OutputSinkAdapter, MementoAdapter, DebugAdapter, FileWatcherAdapter } from '@ui/adapters';
import { ServerLogChannel } from '@ui/channels';
import { ServerTreeViewProvider } from '@ui/tree';
import { ServerFormPanel } from '@ui/webviews/panels/ServerFormPanel';
import { DeploymentFormPanel } from '@ui/webviews/panels/DeploymentFormPanel';
import { registerServerCommands, registerDeploymentCommands, registerTemplateCommands } from '@ui/commands';
import {
  MAIN_OUTPUT_CHANNEL,
  VIEW_ID,
  WORKSPACE_CONFIG_DIR,
} from './constants';

// ── Disposables ─────────────────────────────────────────────────────────────

const disposables: vscode.Disposable[] = [];

// ── Activate ────────────────────────────────────────────────────────────────

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    // No workspace — nothing to manage
    return;
  }

  // ── 1. Infra layer ──────────────────────────────────────────────────────

  const outputChannel = vscode.window.createOutputChannel(MAIN_OUTPUT_CHANNEL, { log: true });
  disposables.push(outputChannel);
  const outputSink = new OutputSinkAdapter(outputChannel);

  const ringBuffer = new RingBuffer();
  const logger = new Logger({ scope: 'JSM', sink: outputSink }, ringBuffer);

  const configRepo = new ConfigRepo(workspaceFolder, logger);
  const globalStore = new MementoAdapter(ctx.globalState);
  const workspaceStore = new MementoAdapter(ctx.workspaceState);
  const processSpawner = new ProcessSpawner(logger);
  const portScanner = new PortScanner();
  const pidManager = new PidManager(
    path.join(workspaceFolder, WORKSPACE_CONFIG_DIR),
    logger,
  );

  // ── 2. Core layer ──────────────────────────────────────────────────────

  const eventBus = new EventBus(logger);
  disposables.push(eventBus);

  const opQueueFactory = (serverId: ServerId): OperationQueue =>
    new OperationQueue(serverId, logger);

  const validator = new SchemaValidator();

  // ── 3. Plugins layer ──────────────────────────────────────────────────

  const pluginRegistry = new PluginRegistry(logger);
  pluginRegistry.register('tomcat', (l: ILogger) => new TomcatPlugin(l));

  // ── 4. UI adapters (needed by app layer) ──────────────────────────────

  const debugAdapter = new DebugAdapter();
  const fileWatcherAdapter = new FileWatcherAdapter();

  // ── 5. App layer ──────────────────────────────────────────────────────

  const hookExecutor: HookExecutor = {
    async runCommand(hook: HookConfig): Promise<Result<void, JsmError>> {
      try {
        const cmd = hook.command;
        if (!cmd) {
          return err(new JsmError({ code: ErrorCode.HookFailed, message: 'Hook has no command config' }));
        }
        const child = processSpawner.spawn({
          exe: cmd.exe,
          args: cmd.args,
          cwd: cmd.cwd ?? workspaceFolder,
          env: cmd.env,
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
    async runVscodeTask(hook: HookConfig): Promise<Result<void, JsmError>> {
      try {
        const taskName = hook.vscodeTask?.taskName ?? 'JSM Hook';
        const taskExecution = await vscode.tasks.executeTask(
          new vscode.Task(
            { type: 'jsm.hook' },
            vscode.TaskScope.Workspace,
            taskName,
            'JSM',
            new vscode.ShellExecution(taskName),
          ),
        );
        await new Promise<void>((resolve) => {
          const d = vscode.tasks.onDidEndTaskProcess((ev) => {
            if (ev.execution === taskExecution) {
              d.dispose();
              resolve();
            }
          });
        });
        return ok(undefined);
      } catch (e) {
        return err(
          new JsmError({ code: ErrorCode.HookFailed, message: `VS Code task hook failed: ${String(e)}` }),
        );
      }
    },
  };

  // HookRunner available for future use in lifecycle hooks
  void new HookRunner({ executor: hookExecutor, logger });

  const configService = new ConfigService({
    repo: configRepo,
    validator,
    bus: eventBus,
    logger,
  });

  // TrustGate (§12.8): injected into services that perform side-effecting operations
  const trustGate = { isTrusted: () => vscode.workspace.isTrusted };

  const lifecycle = new ServerLifecycle({
    pluginRegistry,
    bus: eventBus,
    pidManager,
    portScanner,
    debugAttacher: debugAdapter,
    logger,
    trustGate,
  });

  const deployService = new DeploymentService({
    pluginRegistry,
    bus: eventBus,
    logger,
    trustGate,
  });

  const autoSyncService = new AutoSyncService({
    bus: eventBus,
    watcherFactory: fileWatcherAdapter,
    logger,
    trustGate,
    onSyncRequest: async (
      serverId: ServerId,
      _deploymentId: DeploymentId,
      batch: FileChangeBatch,
    ) => {
      const config = configService.getServer(serverId);
      if (!config) return;
      const deployment = config.deployments?.find(
        d => d.id === _deploymentId,
      );
      if (!deployment) return;
      const runtime = lifecycle.getRuntime(serverId);
      if (!runtime) return;
      const opCtx: OperationContext = {
        operationId: `autosync-${Date.now()}`,
        serverId,
        kind: 'DeployIncremental',
        targetDeploymentId: _deploymentId,
        startedAt: Date.now(),
        timeoutMs: 30_000,
        cancel: { isCancelled: false, onCancelled: () => ({ dispose: () => {} }) },
        progress: { report: () => {} },
        output: { append: () => {}, appendLine: () => {}, clear: () => {} },
      };
      await deployService.sync(opCtx, config, deployment, batch);
    },
  });
  disposables.push(autoSyncService);

  const templateService = new TemplateService({
    globalStore,
    workspaceStore,
    logger,
  });

  const extensionVersion = vscode.extensions.getExtension('java-server-manager')?.packageJSON?.version
    ?? ctx.extension.packageJSON.version
    ?? '0.0.0';

  const diagnosticsService = new DiagnosticsService({
    extensionVersion,
    getConfigs: () => configService.getAllServers(),
    getRuntimeState: (sid: ServerId) => lifecycle.getRuntime(sid)?.getState(),
    getLogBuffer: () => ringBuffer.getAll().join('\n'),
  });

  // ── 6. UI presentation ────────────────────────────────────────────────

  const logChannel = new ServerLogChannel();
  disposables.push(logChannel);

  const treeProvider = new ServerTreeViewProvider({
    getAllServers: () => configService.getAllServers(),
    getRuntimeState: (sid: ServerId) => lifecycle.getRuntime(sid)?.getState(),
    getDeploymentState: (sid: ServerId, did: DeploymentId) =>
      deployService.getDeploymentState(sid, did),
  });

  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  disposables.push(treeView);

  const serverFormPanel = new ServerFormPanel({
    extensionUri: ctx.extensionUri,
    configService,
    logger,
  });
  disposables.push(serverFormPanel);

  const deploymentFormPanel = new DeploymentFormPanel({
    extensionUri: ctx.extensionUri,
    configService,
    logger,
  });
  disposables.push(deploymentFormPanel);

  // ── 7. Commands ───────────────────────────────────────────────────────

  const configFilePath = configRepo.filePath;

  disposables.push(
    ...registerServerCommands({
      lifecycle,
      configService,
      deployService,
      diagnosticsService,
      logChannel,
      treeProvider,
      serverFormPanel,
      configFilePath,
    }),
    ...registerDeploymentCommands({
      configService,
      deployService,
      treeProvider,
      deploymentFormPanel,
    }),
    ...registerTemplateCommands({
      templateService,
    }),
  );

  // ── 8. Event wiring ──────────────────────────────────────────────────

  disposables.push(
    eventBus.on('ServerStateChanged', ({ serverId, state }) => {
      const config = configService.getServer(serverId);
      const name = config?.name ?? serverId;

      if (state === 'running') {
        logChannel.showLogs(serverId, name);
        // Enable autosync for running servers
        if (config) autoSyncService.enable(config);
      } else if (state === 'stopped' || state === 'error') {
        logChannel.detach(serverId);
        autoSyncService.suspend(serverId);
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

  // ── 9. Load workspace ────────────────────────────────────────────────

  const loadResult = await configService.loadWorkspace();
  if (loadResult.ok) {
    // Register all loaded servers with lifecycle + operation queues
    for (const config of loadResult.value) {
      const queue = opQueueFactory(config.id);
      lifecycle.register(config, queue);
    }

    // Deferred reconciliation — does not block activation (§9.9)
    lifecycle.reconcileRunningServers(loadResult.value).catch((e) => {
      logger.error('Reconciliation failed', e);
    });
  } else {
    logger.error('Failed to load workspace config', loadResult.error);
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

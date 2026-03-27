"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const jsm_servers_schema_json_1 = __importDefault(require("./schema/jsm.servers.schema.json"));
const result_1 = require("@core/result");
const JsmError_1 = require("@core/errors/JsmError");
const codes_1 = require("@core/errors/codes");
const EventBus_1 = require("@core/events/EventBus");
const OperationQueue_1 = require("@core/ops/OperationQueue");
const SchemaValidator_1 = require("@core/validation/SchemaValidator");
const logging_1 = require("@infra/logging");
const fs_1 = require("@infra/fs");
const process_1 = require("@infra/process");
const ports_1 = require("@infra/ports");
const pid_1 = require("@infra/pid");
const PluginRegistry_1 = require("@plugins/registry/PluginRegistry");
const TomcatPlugin_1 = require("@plugins/tomcat/TomcatPlugin");
const config_1 = require("@app/config");
const server_1 = require("@app/server");
const server_2 = require("@app/server");
const deployment_1 = require("@app/deployment");
const sync_1 = require("@app/sync");
const templates_1 = require("@app/templates");
const hooks_1 = require("@app/hooks");
const adapters_1 = require("@ui/adapters");
const channels_1 = require("@ui/channels");
const tree_1 = require("@ui/tree");
const DashboardPanel_1 = require("@ui/webviews/panels/DashboardPanel");
const commands_1 = require("@ui/commands");
const constants_1 = require("./constants");
// ── Disposables ─────────────────────────────────────────────────────────────
const disposables = [];
function workspaceStorageId(workspaceFolderUri) {
    return (0, crypto_1.createHash)('sha1').update(workspaceFolderUri).digest('hex').slice(0, 12);
}
function workspaceFolderUriString(folder) {
    const uri = folder.uri;
    return typeof uri?.toString === 'function' ? uri.toString() : uri?.fsPath ?? '';
}
async function activate(ctx) {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
        // No workspace — nothing to manage
        return;
    }
    const primaryWorkspaceFolder = workspaceFolders[0].uri.fsPath;
    // ── 1. Infra layer ──────────────────────────────────────────────────────
    const outputChannel = vscode.window.createOutputChannel(constants_1.MAIN_OUTPUT_CHANNEL, { log: true });
    disposables.push(outputChannel);
    const outputSink = new adapters_1.OutputSinkAdapter(outputChannel);
    const ringBuffer = new logging_1.RingBuffer();
    const logger = new logging_1.Logger({ scope: 'JSM', sink: outputSink }, ringBuffer);
    const globalStore = new adapters_1.MementoAdapter(ctx.globalState);
    const workspaceStore = new adapters_1.MementoAdapter(ctx.workspaceState);
    const processSpawner = new process_1.ProcessSpawner(logger);
    const portScanner = new ports_1.PortScanner();
    const baseManagedStorageRoot = ctx.storageUri?.fsPath
        ?? path.join(primaryWorkspaceFolder, constants_1.WORKSPACE_CONFIG_DIR, 'jsm-managed-storage');
    const pidManager = new pid_1.PidManager(path.join(baseManagedStorageRoot, 'pids'), logger);
    // ── 2. Core layer ──────────────────────────────────────────────────────
    const eventBus = new EventBus_1.EventBus(logger);
    disposables.push(eventBus);
    /** When set, automated extension tests (JSM_E2E=1) can observe autosync → DeploySync without a real Tomcat. */
    const e2eEnabled = process.env.JSM_E2E === '1';
    const e2eDeploySyncStarted = { count: 0 };
    if (e2eEnabled) {
        disposables.push(eventBus.on('OperationStarted', (e) => {
            if (e.kind === 'DeploySync') {
                e2eDeploySyncStarted.count += 1;
            }
        }));
    }
    const opQueueFactory = (serverId) => new OperationQueue_1.OperationQueue(serverId, logger);
    const validator = new SchemaValidator_1.SchemaValidator();
    validator.registerBuiltInSchemas(jsm_servers_schema_json_1.default);
    // ── 3. Plugins layer ──────────────────────────────────────────────────
    const pluginRegistry = new PluginRegistry_1.PluginRegistry(logger);
    pluginRegistry.register('tomcat', (l) => new TomcatPlugin_1.TomcatPlugin(l, {
        startupListenerJarPath: path.join(ctx.extensionUri.fsPath, 'assets', 'tomcat', 'jsm-tomcat-startup-listener.jar'),
        serverXmlTemplatePath: path.join(ctx.extensionUri.fsPath, 'assets', 'tomcat', 'server.xml.template'),
        keyValueStore: workspaceStore,
    }));
    // ── 4. UI adapters (needed by app layer) ──────────────────────────────
    const debugAdapter = new adapters_1.DebugAdapter();
    disposables.push(debugAdapter.onDidChangeSession(({ serverId, attached }) => {
        const runtime = lifecycle.getRuntime(serverId);
        if (runtime)
            runtime.setDebugAttached(attached);
    }));
    const fileWatcherAdapter = new adapters_1.FileWatcherAdapter();
    const logChannel = new channels_1.ServerLogChannel();
    disposables.push(logChannel);
    // ── 5. App layer ──────────────────────────────────────────────────────
    async function resolveHookTask(taskName) {
        const normalizedTaskName = taskName.trim();
        if (normalizedTaskName.length === 0) {
            return (0, result_1.err)(new JsmError_1.JsmError({
                code: codes_1.ErrorCode.InvalidConfig,
                message: 'VS Code hook task name is required',
            }));
        }
        const tasks = await vscode.tasks.fetchTasks();
        const matches = tasks.filter(candidate => candidate.name.trim() === normalizedTaskName);
        if (matches.length === 0) {
            return (0, result_1.err)(new JsmError_1.JsmError({
                code: codes_1.ErrorCode.InvalidConfig,
                message: `VS Code task '${normalizedTaskName}' not found`,
            }));
        }
        if (matches.length > 1) {
            return (0, result_1.err)(new JsmError_1.JsmError({
                code: codes_1.ErrorCode.InvalidConfig,
                message: `VS Code task '${normalizedTaskName}' is ambiguous; use a unique task name`,
            }));
        }
        return (0, result_1.ok)(matches[0]);
    }
    const hookExecutor = {
        async runCommand(request) {
            try {
                const cmd = request.hook.command;
                if (!cmd) {
                    return (0, result_1.err)(new JsmError_1.JsmError({ code: codes_1.ErrorCode.HookFailed, message: 'Hook has no command config' }));
                }
                const child = processSpawner.spawnShell({
                    line: cmd.line,
                    cwd: cmd.cwd ?? primaryWorkspaceFolder,
                    env: cmd.env,
                    onData: (chunk) => request.parent.output.append(chunk),
                });
                await new Promise((resolve, reject) => {
                    child.on('close', (code) => {
                        if (code === 0)
                            resolve();
                        else
                            reject(new Error(`Hook exited with code ${code}`));
                    });
                    child.on('error', reject);
                });
                return (0, result_1.ok)(undefined);
            }
            catch (e) {
                return (0, result_1.err)(new JsmError_1.JsmError({ code: codes_1.ErrorCode.HookFailed, message: `Hook command failed: ${String(e)}` }));
            }
        },
        async runVscodeTask(request) {
            try {
                const taskName = request.hook.vscodeTask?.taskName ?? 'JSM Hook';
                const taskResult = await resolveHookTask(taskName);
                if (!taskResult.ok) {
                    return taskResult;
                }
                request.parent.output.appendLine(`Starting VS Code task hook '${taskName}'`);
                const taskExecution = await vscode.tasks.executeTask(taskResult.value);
                const exitCode = await new Promise((resolve) => {
                    const d = vscode.tasks.onDidEndTaskProcess((ev) => {
                        if (ev.execution === taskExecution) {
                            d.dispose();
                            resolve(ev.exitCode);
                        }
                    });
                });
                if (exitCode !== undefined && exitCode !== 0) {
                    return (0, result_1.err)(new JsmError_1.JsmError({
                        code: codes_1.ErrorCode.HookFailed,
                        message: `VS Code task '${taskName}' failed with exit code ${exitCode}`,
                    }));
                }
                request.parent.output.appendLine(`VS Code task hook '${taskName}' completed`);
                return (0, result_1.ok)(undefined);
            }
            catch (e) {
                return (0, result_1.err)(new JsmError_1.JsmError({ code: codes_1.ErrorCode.HookFailed, message: `VS Code task hook failed: ${String(e)}` }));
            }
        },
    };
    // TrustGate (§12.8): injected into services that perform side-effecting operations
    const trustGate = { isTrusted: () => vscode.workspace.isTrusted };
    const hookRunner = new hooks_1.HookRunner({ executor: hookExecutor, logger, trustGate });
    function buildWorkspaceServiceEntry(folder) {
        const scopeUri = workspaceFolderUriString(folder);
        const scope = {
            uri: scopeUri,
            name: folder.name,
            fsPath: folder.uri.fsPath,
        };
        const configRepo = new fs_1.ConfigRepo(folder.uri.fsPath, logger);
        const configService = new config_1.ConfigService({
            repo: configRepo,
            validator,
            bus: eventBus,
            logger,
            workspaceFolderUri: scope.uri,
            trustGate,
        });
        const managedInstancePathResolver = new server_2.ManagedInstancePathResolver(path.join(baseManagedStorageRoot, 'workspaces', workspaceStorageId(scope.uri), 'instances'));
        const provisioningService = new server_2.ServerProvisioningService({
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
    const workspaceServiceRegistry = new config_1.WorkspaceServiceRegistry(workspaceFolders.map(buildWorkspaceServiceEntry), logger);
    const deployService = new deployment_1.DeploymentService({
        pluginRegistry,
        bus: eventBus,
        logger,
        trustGate,
        hookRunner,
    });
    const autoSyncRef = {};
    const lifecycle = new server_1.ServerLifecycle({
        pluginRegistry,
        bus: eventBus,
        pidManager,
        portScanner,
        debugAttacher: debugAdapter,
        logger,
        trustGate,
        hookRunner,
        getOutputSink: (serverId, serverName) => ({
            append: (text) => {
                logChannel.getChannel(serverId, serverName).append(text);
            },
            appendLine: (text) => {
                logChannel.appendLine(serverId, serverName, text);
            },
            clear: () => {
                logChannel.getChannel(serverId, serverName).clear();
            },
        }),
        deployService,
        resolveServerConfig: serverKey => workspaceServiceRegistry.getServerRecordByKey(serverKey)?.config,
        onDeploySyncFailure: (serverKey, deploymentId) => {
            autoSyncRef.current?.recordFailure(serverKey, deploymentId);
        },
    });
    const autoSyncService = new sync_1.AutoSyncService({
        bus: eventBus,
        watcherFactory: fileWatcherAdapter,
        logger,
        trustGate,
        onSyncRequest: async (serverId, deploymentId, batch) => {
            if (!lifecycle.getRuntime(serverId))
                return;
            const enqueued = lifecycle.enqueueDeploySync(serverId, deploymentId, batch);
            if (!enqueued.ok) {
                autoSyncRef.current?.recordFailure(serverId, deploymentId);
            }
        },
    });
    autoSyncRef.current = autoSyncService;
    disposables.push(autoSyncService);
    /** Recreate autosync watchers from latest saved config when the server is running. */
    function refreshAutosyncIfRunning(serverKey) {
        if (lifecycle.getRuntime(serverKey)?.getState().state !== 'running')
            return;
        const cfg = workspaceServiceRegistry.getServerRecordByKey(serverKey)?.config;
        if (!cfg)
            return;
        autoSyncService.rebindWatchers(serverKey, cfg);
    }
    async function loadAndRegisterServersForWorkspace(scopeUri, scopeNameForLog) {
        const entry = workspaceServiceRegistry.getEntry(scopeUri);
        if (!entry) {
            return [];
        }
        const loadResult = await entry.configService.loadWorkspace();
        if (!loadResult.ok) {
            logger.error(`Failed to load workspace config for '${scopeNameForLog}'`, loadResult.error);
            return [];
        }
        const out = [];
        for (const config of loadResult.value) {
            const serverKey = (0, config_1.makeWorkspaceServerKey)(scopeUri, config.id);
            const queue = opQueueFactory(serverKey);
            lifecycle.register(serverKey, config, queue);
            out.push({ serverKey, config });
        }
        return out;
    }
    function teardownWorkspaceFolder(scopeUri) {
        const records = workspaceServiceRegistry.getServers(scopeUri);
        for (const record of records) {
            const { serverKey } = record;
            lifecycle.unregister(serverKey);
            logChannel.detach(serverKey);
            autoSyncService.purgeServerWatchState(serverKey);
        }
    }
    const templateService = new templates_1.TemplateService({
        globalStore,
        workspaceStore,
        logger,
        trustGate,
    });
    const discoveryService = new server_2.ServerDiscoveryService(pluginRegistry, logger);
    // ── 6. UI presentation ────────────────────────────────────────────────
    const treeProvider = new tree_1.ServerTreeViewProvider({
        getWorkspaceFolders: () => workspaceServiceRegistry.getWorkspaceScopes().map(scope => ({
            workspaceFolderUri: scope.uri,
            workspaceFolderName: scope.name,
        })),
        getServers: (workspaceFolderUri) => workspaceServiceRegistry.getServers(workspaceFolderUri),
        getRuntimeState: (sid) => lifecycle.getRuntime(sid)?.getState(),
        isQueueBusy: (sid) => lifecycle.isQueueBusy(sid),
        getDeploymentState: (sid, did) => deployService.getDeploymentState(sid, did),
        getDeploymentHealth: (sid, did) => deployService.getDeploymentHealth(sid, did),
    });
    const treeView = vscode.window.createTreeView(constants_1.VIEW_ID, {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    disposables.push(treeView);
    disposables.push(eventBus.on('OperationStarted', () => {
        treeProvider.requestRefresh();
    }), eventBus.on('OperationCompleted', () => {
        treeProvider.requestRefresh();
    }), eventBus.on('OperationFailed', () => {
        treeProvider.requestRefresh();
    }));
    const dashboardPanel = new DashboardPanel_1.DashboardPanel({
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
    disposables.push(vscode.commands.registerCommand('jsm.dashboard.open', (target) => {
        dashboardPanel.show(target);
    }), ...(0, commands_1.registerServerCommands)({
        lifecycle,
        pluginRegistry,
        logChannel,
        workspaceRegistry: workspaceServiceRegistry,
        discoveryService,
        treeProvider,
        schemaValidator: validator,
        openDashboard: target => dashboardPanel.show(target),
    }), ...(0, commands_1.registerDeploymentCommands)({
        workspaceRegistry: workspaceServiceRegistry,
        pluginRegistry,
        lifecycle,
        treeProvider,
    }));
    // ── 8. Event wiring ──────────────────────────────────────────────────
    disposables.push(eventBus.on('ServerAdded', ({ serverId, workspaceFolderUri }) => {
        const config = workspaceServiceRegistry.getServer({ workspaceFolderUri, serverId });
        if (config) {
            const serverKey = (0, config_1.makeWorkspaceServerKey)(workspaceFolderUri, serverId);
            const queue = opQueueFactory(serverKey);
            lifecycle.register(serverKey, config, queue);
        }
        treeProvider.requestRefresh();
    }), eventBus.on('ServerUpdated', ({ serverId, workspaceFolderUri }) => {
        const config = workspaceServiceRegistry.getServer({ workspaceFolderUri, serverId });
        const serverKey = (0, config_1.makeWorkspaceServerKey)(workspaceFolderUri, serverId);
        if (config) {
            lifecycle.updateConfig(serverKey, config);
            refreshAutosyncIfRunning(serverKey);
        }
        treeProvider.requestRefresh();
    }), eventBus.on('ServerDeleted', ({ serverId, workspaceFolderUri }) => {
        const serverKey = (0, config_1.makeWorkspaceServerKey)(workspaceFolderUri, serverId);
        lifecycle.unregister(serverKey);
        logChannel.detach(serverKey);
        autoSyncService.purgeServerWatchState(serverKey);
        treeProvider.requestRefresh();
    }), eventBus.on('DeploymentAdded', ({ serverId, workspaceFolderUri }) => {
        const config = workspaceServiceRegistry.getServer({ workspaceFolderUri, serverId });
        const serverKey = (0, config_1.makeWorkspaceServerKey)(workspaceFolderUri, serverId);
        if (config) {
            lifecycle.updateConfig(serverKey, config);
            refreshAutosyncIfRunning(serverKey);
        }
        treeProvider.requestRefresh();
    }), eventBus.on('DeploymentUpdated', ({ serverId, workspaceFolderUri }) => {
        const config = workspaceServiceRegistry.getServer({ workspaceFolderUri, serverId });
        const serverKey = (0, config_1.makeWorkspaceServerKey)(workspaceFolderUri, serverId);
        if (config) {
            lifecycle.updateConfig(serverKey, config);
            refreshAutosyncIfRunning(serverKey);
        }
        treeProvider.requestRefresh();
    }), eventBus.on('DeploymentRemoved', ({ serverId, workspaceFolderUri }) => {
        const config = workspaceServiceRegistry.getServer({ workspaceFolderUri, serverId });
        const serverKey = (0, config_1.makeWorkspaceServerKey)(workspaceFolderUri, serverId);
        if (config) {
            lifecycle.updateConfig(serverKey, config);
            refreshAutosyncIfRunning(serverKey);
        }
        treeProvider.requestRefresh();
    }), eventBus.on('ServerStateChanged', ({ serverId, state }) => {
        const record = workspaceServiceRegistry.getServerRecordByKey(serverId);
        const config = record?.config;
        const name = config?.name ?? serverId;
        if (state === 'starting') {
            const channel = logChannel.getChannel(serverId, name);
            channel.clear();
            logChannel.showLogs(serverId, name);
        }
        else if (state === 'running') {
            logChannel.showLogs(serverId, name);
            if (config)
                autoSyncService.rebindWatchers(serverId, config);
        }
        else if (state === 'stopped' || state === 'error') {
            autoSyncService.suspend(serverId);
            autoSyncService.disable(serverId);
        }
        treeProvider.requestRefresh();
    }), eventBus.on('ConfigChanged', () => {
        treeProvider.requestRefresh();
    }), eventBus.on('DeploymentStateChanged', () => {
        treeProvider.requestRefresh();
    }));
    disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
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
                lifecycle.reconcileRunningServers(loaded).catch((err) => {
                    logger.error('Reconciliation failed after workspace folder added', err);
                });
            }
        }
        if (e.removed.length > 0 || e.added.length > 0) {
            treeProvider.forceRefresh();
        }
    }));
    // ── 9. Load workspace ────────────────────────────────────────────────
    const loadedServers = [];
    for (const scope of workspaceServiceRegistry.getWorkspaceScopes()) {
        const chunk = await loadAndRegisterServersForWorkspace(scope.uri, scope.name);
        loadedServers.push(...chunk);
    }
    treeProvider.forceRefresh();
    if (loadedServers.length > 0) {
        const reconcilePromise = lifecycle.reconcileRunningServers(loadedServers);
        if (e2eEnabled) {
            try {
                await reconcilePromise;
            }
            catch (e) {
                logger.error('Reconciliation failed', e);
            }
            for (const s of loadedServers) {
                lifecycle.getRuntime(s.serverKey)?.forceState('running', { pid: process.pid });
            }
        }
        else {
            reconcilePromise.catch((e) => {
                logger.error('Reconciliation failed', e);
            });
        }
    }
    // Push all to context subscriptions for cleanup
    ctx.subscriptions.push(...disposables);
    logger.info('Java Server Manager activated');
    if (e2eEnabled) {
        return {
            __e2eGetDeploySyncStartedCount: () => e2eDeploySyncStarted.count,
        };
    }
}
// ── Deactivate ──────────────────────────────────────────────────────────────
function deactivate() {
    for (const d of disposables) {
        d.dispose();
    }
    disposables.length = 0;
}

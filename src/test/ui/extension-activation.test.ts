/**
 * Exhaustive test suite: Extension Activation & Deactivation
 *
 * Categories: happy path (full activation), negative path (no workspace),
 * edge cases (loading failure, reconciliation failure), recovery, lifecycle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSchemaValidatorRegisterBuiltInSchemas = vi.fn();
const mockEventBusOn = vi.fn();
const mockTreeProviderRequestRefresh = vi.fn();
const mockTreeProviderForceRefresh = vi.fn();
const mockLogChannelDetach = vi.fn();
const mockAutoSyncSuspend = vi.fn();
const mockAutoSyncDisable = vi.fn();
const mockAutoSyncPurgeServerWatchState = vi.fn();
const mockAutoSyncRebindWatchers = vi.fn();
const mockLifecycleUpdateConfig = vi.fn();
const mockLifecycleUnregister = vi.fn();
const mockPluginRegistryDispose = vi.fn(async () => {});
const mockConfigRepoCtorArgs: unknown[][] = [];
const mockDeploymentServiceCtorArgs: unknown[][] = [];
const mockBuildRunnerCtorArgs: unknown[][] = [];

let mockLogChannelInstance: any = null;
let mockChannelInstance: any = null;

const eventHandlers = new Map<string, (payload: any) => void>();

/* ══════════════════════════════════════════════════════════════════════════
 * VS Code mock — elaborate mock to support extension.ts activation
 * ══════════════════════════════════════════════════════════════════════════ */

const mockShowOutputChannel = vi.fn();
const mockCreateOutputChannel = vi.fn(() => ({
  append: vi.fn(),
  appendLine: vi.fn(),
  clear: vi.fn(),
  show: vi.fn(),
  dispose: vi.fn(),
}));
const mockCreateTreeView = vi.fn(() => ({
  dispose: vi.fn(),
  onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
}));
const mockRegisterCommand = vi.fn((_id: string, _handler: unknown) => ({ dispose: vi.fn() }));
const mockOnDidEndTaskProcess = vi.fn(() => ({ dispose: vi.fn() }));

let workspaceFolders: { uri: { fsPath: string } }[] | undefined;

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: mockCreateOutputChannel,
    createTreeView: mockCreateTreeView,
    createWebviewPanel: vi.fn(() => ({
      webview: {
        html: '',
        postMessage: vi.fn(),
        asWebviewUri: vi.fn(() => ({ toString: () => 'mock-uri' })),
        cspSource: 'https://mock.vscode-cdn.net',
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      reveal: vi.fn(),
      dispose: vi.fn(),
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    })),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  commands: { registerCommand: mockRegisterCommand },
  workspace: {
    get workspaceFolders() { return workspaceFolders; },
    openTextDocument: vi.fn(async () => ({})),
    isTrusted: true,
    onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  },
  env: {
    clipboard: { writeText: vi.fn() },
  },
  extensions: {
    getExtension: vi.fn(() => ({ packageJSON: { version: '0.0.1-test' } })),
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, path: p }),
    joinPath: (_base: unknown, ...segments: string[]) => ({ path: segments.join('/'), fsPath: '/' + segments.join('/') }),
  },
  ViewColumn: { One: 1 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class {
    constructor(public label: string, public collapsibleState: number) {}
  },
  ThemeIcon: class { constructor(public id: string) {} },
  MarkdownString: class {
    isTrusted = false;
    appendMarkdown() { return this; }
  },
  tasks: {
    executeTask: vi.fn(),
    onDidEndTaskProcess: mockOnDidEndTaskProcess,
  },
  Task: class { constructor(..._args: unknown[]) {} },
  TaskScope: { Workspace: 1 },
  ShellExecution: class { constructor(..._args: unknown[]) {} },
}));

/* ══════════════════════════════════════════════════════════════════════════
 * Mock internal dependencies that extension.ts imports
 * ══════════════════════════════════════════════════════════════════════════ */

// Logger + RingBuffer
vi.mock('@infra/logging', () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  },
  RingBuffer: class {
    push = vi.fn();
    getAll = vi.fn(() => []);
  },
}));

// ConfigRepo
vi.mock('@infra/fs', () => ({
  ConfigRepo: class {
    filePath: string;
    constructor(...args: unknown[]) {
      mockConfigRepoCtorArgs.push(args);
      const options = args[2] as { storageRoot?: string } | undefined;
      this.filePath = options?.storageRoot
        ? `${options.storageRoot}/jsm.servers.json`
        : '/workspace/.vscode/jsm.servers.json';
    }
    loadWorkspace = vi.fn();
    save = vi.fn();
  },
}));

// ProcessSpawner
vi.mock('@infra/process', () => ({
  ProcessSpawner: class {
    spawn = vi.fn();
  },
}));

// PortScanner
vi.mock('@infra/ports', () => ({
  PortScanner: class {},
}));

// PidManager
vi.mock('@infra/pid', () => ({
  PidManager: class {},
}));

// PluginRegistry
vi.mock('@plugins/registry/PluginRegistry', () => ({
  PluginRegistry: class {
    register = vi.fn();
    dispose = mockPluginRegistryDispose;
  },
}));

// TomcatPlugin
vi.mock('@plugins/tomcat/TomcatPlugin', () => ({
  TomcatPlugin: class {},
}));

// ConfigService
const mockConfigServiceLoadWorkspace = vi.fn(async () => ({ ok: true, value: [] }));
const mockConfigServiceGetServer = vi.fn();
const mockConfigServiceGetAllServers = vi.fn(() => []);
const mockConfigServiceReload = vi.fn(async () => ({ ok: true, value: [] }));

const mockGetWorkspaceScopes = vi.fn(() => []);
const mockGetEntry = vi.fn();
const mockGetServer = vi.fn();
const mockGetServerRecordByKey = vi.fn();

vi.mock('@app/config', () => ({
  ConfigService: class {
    loadWorkspace = mockConfigServiceLoadWorkspace;
    getServer = mockConfigServiceGetServer;
    getAllServers = mockConfigServiceGetAllServers;
    reload = mockConfigServiceReload;
  },
  WorkspaceServiceRegistry: class {
    getWorkspaceScopes = mockGetWorkspaceScopes;
    getServers = vi.fn(() => []);
    getServer = mockGetServer;
    getServerRecordByKey = mockGetServerRecordByKey;
    getEntry = mockGetEntry;
    getEntryByFolderUri = vi.fn();
    reloadAll = vi.fn(async () => ({ ok: true, value: undefined }));
    addServer = vi.fn(async () => ({ ok: true, value: undefined }));
    updateServer = vi.fn(async () => ({ ok: true, value: undefined }));
    addDeployment = vi.fn(async () => ({ ok: true, value: undefined }));
  },
  makeWorkspaceServerKey: (uri: string | undefined, serverId: string) => uri ? `${uri}::${serverId}` : serverId,
}));

// ServerLifecycle
const mockLifecycleRegister = vi.fn();
const mockLifecycleReconcile = vi.fn(async () => {});

vi.mock('@app/server', () => ({
  ServerLifecycle: class {
    register = mockLifecycleRegister;
    updateConfig = mockLifecycleUpdateConfig;
    unregister = mockLifecycleUnregister;
    reconcileRunningServers = mockLifecycleReconcile;
    getRuntime = vi.fn();
  },
  ManagedInstancePathResolver: class {},
  ServerProvisioningService: class {},
  ServerDiscoveryService: class {
    discover = vi.fn(async () => []);
  },
}));

// DeploymentService
vi.mock('@app/deployment', () => ({
  HookBackedDeploymentBuildRunner: class {
    constructor(...args: unknown[]) {
      mockBuildRunnerCtorArgs.push(args);
    }
  },
  DeploymentService: class {
    constructor(...args: unknown[]) {
      mockDeploymentServiceCtorArgs.push(args);
    }
    getDeploymentState = vi.fn(() => 'undeployed');
  },
}));

// AutoSyncService
vi.mock('@app/sync', () => ({
  AutoSyncService: class {
    enable = vi.fn();
    rebindWatchers = mockAutoSyncRebindWatchers;
    suspend = mockAutoSyncSuspend;
    disable = mockAutoSyncDisable;
    purgeServerWatchState = mockAutoSyncPurgeServerWatchState;
    dispose = vi.fn();
  },
}));

// TemplateService
vi.mock('@app/templates', () => ({
  TemplateService: class {},
}));

// DiagnosticsService
vi.mock('@app/diagnostics', () => ({
  DiagnosticsService: class {
    generateBundleText = vi.fn(() => 'diag');
  },
}));

// LocalTelemetryService
vi.mock('@app/telemetry', () => ({
  LocalTelemetryService: class {
    getSnapshot = vi.fn(() => undefined);
    clear = vi.fn(async () => undefined);
    dispose = vi.fn();
  },
}));

// HookRunner
vi.mock('@app/hooks', () => ({
  HookRunner: class {},
}));

// UI Adapters
vi.mock('@ui/adapters', () => ({
  OutputSinkAdapter: class {
    append = vi.fn(); appendLine = vi.fn(); clear = vi.fn();
  },
  MementoAdapter: class {
    get = vi.fn(); set = vi.fn(); 'delete' = vi.fn();
  },
  DebugAdapter: class {
    onDidChangeSession = vi.fn(() => ({ dispose: vi.fn() }));
    dispose = vi.fn();
  },
  FileWatcherAdapter: class {},
}));

// ServerLogChannel
vi.mock('@ui/channels', () => ({
  ServerLogChannel: class {
    constructor() {
      mockLogChannelInstance = this;
    }

    showLogs = vi.fn();
    detach = mockLogChannelDetach;
    dispose = vi.fn();
    getChannel = vi.fn((_serverId: string, _serverName: string) => {
      mockChannelInstance = { clear: vi.fn() };
      return mockChannelInstance;
    });
  },
}));

// Tree provider
vi.mock('@ui/tree', () => ({
  ServerTreeViewProvider: class {
    requestRefresh = mockTreeProviderRequestRefresh;
    forceRefresh = mockTreeProviderForceRefresh;
  },
}));

// Commands
vi.mock('@ui/commands', () => ({
  registerServerCommands: vi.fn(() => [{ dispose: vi.fn() }]),
  registerDeploymentCommands: vi.fn(() => [{ dispose: vi.fn() }]),
}));

// SchemaValidator
vi.mock('@core/validation/SchemaValidator', () => ({
  SchemaValidator: class {
    registerBuiltInSchemas = mockSchemaValidatorRegisterBuiltInSchemas;
  },
}));

// EventBus
vi.mock('@core/events/EventBus', () => ({
  EventBus: class {
    on = mockEventBusOn.mockImplementation((event: string, handler: (payload: any) => void) => {
      eventHandlers.set(event, handler);
      return { dispose: vi.fn() };
    });
    emit = vi.fn();
    dispose = vi.fn();
  },
}));

// OperationQueue
vi.mock('@core/ops/OperationQueue', () => ({
  OperationQueue: class {},
}));

/* ══════════════════════════════════════════════════════════════════════════
 * Import (after all mocks)
 * ══════════════════════════════════════════════════════════════════════════ */

const { activate, deactivate } = await import('../../extension');

/* ══════════════════════════════════════════════════════════════════════════
 * Tests
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Extension Activation', () => {
  let ctx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers.clear();
    mockConfigRepoCtorArgs.length = 0;
    mockDeploymentServiceCtorArgs.length = 0;
    mockBuildRunnerCtorArgs.length = 0;
    mockConfigServiceLoadWorkspace.mockResolvedValue({ ok: true, value: [] });
    mockLifecycleReconcile.mockResolvedValue(undefined);
    mockPluginRegistryDispose.mockResolvedValue(undefined);

    ctx = {
      extensionUri: { path: '/mock-ext' },
      extension: { packageJSON: { version: '0.0.1-test' } },
      globalState: {
        get: vi.fn(),
        update: vi.fn(),
        keys: vi.fn(() => []),
      },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
        keys: vi.fn(() => []),
      },
      storageUri: { fsPath: '/vscode/storage' },
      subscriptions: [],
    };
  });

  /* ── No Workspace ────────────────────────────────────────────────────── */

  it('should return early when no workspace folder is open', async () => {
    workspaceFolders = undefined;

    await activate(ctx);

    // Should not register any commands when there's no workspace
    expect(ctx.subscriptions.length).toBe(0);
  });

  /* ── Happy Path ──────────────────────────────────────────────────────── */

  it('should activate successfully with a workspace folder', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];

    await activate(ctx);

    // Should have registered disposables
    expect(ctx.subscriptions.length).toBeGreaterThan(0);
    expect(mockCreateOutputChannel).toHaveBeenCalled();
    expect(mockCreateTreeView).toHaveBeenCalled();
    expect(mockSchemaValidatorRegisterBuiltInSchemas).toHaveBeenCalledWith(expect.any(Object));
  });

  it('should create the managed inventory repo under VS Code workspace storage', async () => {
    workspaceFolders = [{
      name: 'Test Workspace',
      uri: {
        fsPath: '/test/workspace',
        toString: () => 'file:///test/workspace',
      },
    } as any];

    await activate(ctx);

    expect(mockConfigRepoCtorArgs).toHaveLength(1);
    const repoOptions = mockConfigRepoCtorArgs[0][2] as { storageRoot?: string };
    const normalizedStorageRoot = repoOptions.storageRoot?.replace(/\\/g, '/');
    expect(normalizedStorageRoot).toMatch(/^\/vscode\/storage\/workspaces\/[a-f0-9]{12}\/inventory$/);
    expect(normalizedStorageRoot).not.toContain('/test/workspace/.vscode');
  });

  it('should wire the hook-backed build runner into deployment service', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];

    await activate(ctx);

    expect(mockBuildRunnerCtorArgs).toHaveLength(1);
    expect(mockDeploymentServiceCtorArgs).toHaveLength(1);
    const buildRunnerDeps = mockBuildRunnerCtorArgs[0][0] as { hookRunner?: unknown };
    const deploymentServiceDeps = mockDeploymentServiceCtorArgs[0][0] as { buildRunner?: unknown; hookRunner?: unknown };
    expect(buildRunnerDeps.hookRunner).toBeDefined();
    expect(deploymentServiceDeps.hookRunner).toBe(buildRunnerDeps.hookRunner);
    expect(deploymentServiceDeps.buildRunner).toBeDefined();
  });

  function setupWorkspaceScope() {
    mockGetWorkspaceScopes.mockReturnValue([
      { uri: '/test/workspace', name: 'Test', fsPath: '/test/workspace' },
    ]);
    mockGetEntry.mockReturnValue({
      configService: { loadWorkspace: mockConfigServiceLoadWorkspace },
    });
  }

  it('should load workspace config on activation', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    setupWorkspaceScope();

    await activate(ctx);

    expect(mockConfigServiceLoadWorkspace).toHaveBeenCalled();
  });

  it('should register loaded servers with lifecycle', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    setupWorkspaceScope();

    const server = { id: 'srv-1', name: 'Test', type: 'tomcat' };
    mockConfigServiceLoadWorkspace.mockResolvedValue({ ok: true, value: [server] });

    await activate(ctx);

    expect(mockLifecycleRegister).toHaveBeenCalledWith('/test/workspace::srv-1', server, expect.anything());
  });

  it('should refresh the tree immediately after loading workspace config', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    const server = { id: 'srv-1', name: 'Test', type: 'tomcat' };
    mockConfigServiceLoadWorkspace.mockResolvedValue({ ok: true, value: [server] });

    await activate(ctx);

    expect(mockTreeProviderForceRefresh).toHaveBeenCalled();
  });

  it('should trigger reconciliation after loading', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    setupWorkspaceScope();

    const server = { id: 'srv-1', name: 'Test', type: 'tomcat' };
    mockConfigServiceLoadWorkspace.mockResolvedValue({ ok: true, value: [server] });

    await activate(ctx);

    expect(mockLifecycleReconcile).toHaveBeenCalled();
  });

  it('should register and refresh when a server is added after activation', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    setupWorkspaceScope();
    const server = { id: 'srv-1', name: 'Test', type: 'tomcat' };
    mockGetServer.mockReturnValue(server);

    await activate(ctx);

    eventHandlers.get('ServerAdded')?.({ serverId: 'srv-1' });

    expect(mockLifecycleRegister).toHaveBeenCalledWith('srv-1', server, expect.anything());
    expect(mockTreeProviderRequestRefresh).toHaveBeenCalled();
  });

  it('should unregister and refresh when a server is deleted', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    setupWorkspaceScope();

    await activate(ctx);

    eventHandlers.get('ServerDeleted')?.({ serverId: 'srv-1' });

    expect(mockLifecycleUnregister).toHaveBeenCalledWith('srv-1');
    expect(mockLogChannelDetach).toHaveBeenCalledWith('srv-1');
    expect(mockAutoSyncPurgeServerWatchState).toHaveBeenCalledWith('srv-1');
    expect(mockTreeProviderRequestRefresh).toHaveBeenCalled();
  });

  it('should update lifecycle config and refresh when a deployment changes', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    setupWorkspaceScope();
    const server = { id: 'srv-1', name: 'Test', type: 'tomcat' };
    mockConfigServiceGetServer.mockReturnValue(server);

    await activate(ctx);

    eventHandlers.get('DeploymentAdded')?.({ serverId: 'srv-1', deploymentId: 'dep-1' });

    expect(mockLifecycleUpdateConfig).toHaveBeenCalledWith('srv-1', server);
    expect(mockTreeProviderRequestRefresh).toHaveBeenCalled();
  });

  it('should keep the server log channel after a server stops', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    setupWorkspaceScope();
    const server = { id: 'srv-1', name: 'Test', type: 'tomcat' };
    mockConfigServiceGetServer.mockReturnValue(server);

    await activate(ctx);

    eventHandlers.get('ServerStateChanged')?.({ serverId: 'srv-1', state: 'stopped' });

    expect(mockLogChannelDetach).not.toHaveBeenCalled();
    expect(mockAutoSyncSuspend).toHaveBeenCalledWith('srv-1');
    expect(mockAutoSyncDisable).toHaveBeenCalledWith('srv-1');
    expect(mockTreeProviderRequestRefresh).toHaveBeenCalled();
  });

  it('should clear and show log channel when a server transitions to starting', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    setupWorkspaceScope();
    const server = { id: 'srv-1', name: 'Test', type: 'tomcat' };
    mockGetServer.mockReturnValue(server);
    mockGetServerRecordByKey.mockReturnValue({ config: server });

    await activate(ctx);
    mockChannelInstance = null;
    mockLogChannelInstance?.showLogs.mockClear();

    eventHandlers.get('ServerStateChanged')?.({ serverId: 'srv-1', state: 'starting' });

    expect(mockChannelInstance).not.toBeNull();
    expect(mockChannelInstance?.clear).toHaveBeenCalled();
    expect(mockLogChannelInstance?.showLogs).toHaveBeenCalledWith('srv-1', 'Test');
  });

  it('should show logs and rebind autosync on running without clearing the channel', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    setupWorkspaceScope();
    const server = { id: 'srv-1', name: 'Test', type: 'tomcat' };
    mockGetServer.mockReturnValue(server);
    mockGetServerRecordByKey.mockReturnValue({ config: server });

    await activate(ctx);
    mockChannelInstance = null;
    mockLogChannelInstance?.showLogs.mockClear();

    eventHandlers.get('ServerStateChanged')?.({ serverId: 'srv-1', state: 'running' });

    expect(mockLogChannelInstance?.showLogs).toHaveBeenCalledWith('srv-1', 'Test');
    expect(mockAutoSyncSuspend).not.toHaveBeenCalled();
    expect(mockAutoSyncRebindWatchers).toHaveBeenCalledWith('srv-1', server);
    // Production showLogs → getChannel → no channel.clear() on running (only on starting).
  });

  /* ── Negative Path: config load failure ──────────────────────────────── */

  it('should not crash when workspace config loading fails', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    mockConfigServiceLoadWorkspace.mockResolvedValue({
      ok: false,
      error: { code: 'ConfigLoadFailed', message: 'Corrupt file' },
    });

    await expect(activate(ctx)).resolves.not.toThrow();
    // Should NOT register any servers
    expect(mockLifecycleRegister).not.toHaveBeenCalled();
  });

  /* ── Recovery: reconciliation failure ────────────────────────────────── */

  it('should not crash when reconciliation throws', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    mockLifecycleReconcile.mockRejectedValue(new Error('Reconciliation crash'));

    // The reconciliation is fire-and-forget (.catch()), so activation should still complete
    await expect(activate(ctx)).resolves.not.toThrow();
  });
});

describe('Extension Deactivation', () => {
  it('should dispose the plugin registry registered during activation', async () => {
    workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    mockPluginRegistryDispose.mockClear();
    const deactivateCtx = {
      extensionUri: { path: '/mock-ext' },
      extension: { packageJSON: { version: '0.0.1-test' } },
      globalState: {
        get: vi.fn(),
        update: vi.fn(),
        keys: vi.fn(() => []),
      },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
        keys: vi.fn(() => []),
      },
      subscriptions: [],
    };

    await activate(deactivateCtx);
    deactivate();

    expect(mockPluginRegistryDispose).toHaveBeenCalled();
  });

  it('should dispose all disposables without throwing', () => {
    expect(() => deactivate()).not.toThrow();
  });

  it('should be safe to call multiple times', () => {
    deactivate();
    expect(() => deactivate()).not.toThrow();
  });
});

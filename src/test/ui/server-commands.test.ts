import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentConfig, HookConfig, ServerConfig } from '@core/types/domain';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import * as path from 'path';

const mockShowErrorMessage = vi.fn();
const mockShowInfoMessage = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowQuickPick = vi.fn();
const mockShowSaveDialog = vi.fn();
const mockShowOpenDialog = vi.fn();
const mockShowTextDocument = vi.fn();
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockAccess = vi.fn();
const mockWithProgress = vi.fn(async (_options: unknown, task: (progress: { report: ReturnType<typeof vi.fn> }, token: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => { dispose: ReturnType<typeof vi.fn> } }) => unknown) =>
  task(
    { report: vi.fn() },
    {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: vi.fn() }),
    },
  ),
);

vi.mock('fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  access: (...args: unknown[]) => mockAccess(...args),
}));
const mockOpenTextDocument = vi.fn(async (uri: { fsPath: string; path: string }) => ({ uri }));
const mockExecuteCommand = vi.fn();
const registeredHandlers: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: mockShowErrorMessage,
    showInformationMessage: mockShowInfoMessage,
    showWarningMessage: mockShowWarningMessage,
    showQuickPick: mockShowQuickPick,
    showSaveDialog: mockShowSaveDialog,
    showOpenDialog: mockShowOpenDialog,
    showTextDocument: mockShowTextDocument,
    withProgress: mockWithProgress,
    createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    openTextDocument: mockOpenTextDocument,
    workspaceFolders: [{ uri: { fsPath: '/ws', path: '/ws' } }],
  },
  commands: {
    registerCommand: vi.fn((id: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers[id] = handler;
      return { dispose: vi.fn() };
    }),
    executeCommand: mockExecuteCommand,
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, path: p }),
    joinPath: vi.fn((base: { fsPath: string }, ...segments: string[]) =>
      ({ fsPath: [base.fsPath, ...segments].join('/'), path: [base.path, ...segments].join('/') })),
  },
  ProgressLocation: { Notification: 15 },
  ViewColumn: { One: 1 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class {
    constructor(public label: string, public collapsibleState: number) {}
  },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  MarkdownString: class {
    isTrusted = false;
    private buf = '';
    appendMarkdown(s: string) { this.buf += s; return this; }
  },
}));

const { registerServerCommands } = await import('@ui/commands/server-commands');
const { ServerNode } = await import('@ui/tree/ServerTreeViewProvider');
const { makeWorkspaceServerKey } = await import('@app/config');
const { CURRENT_WORKSPACE_CONFIG_VERSION } = await import('@infra/fs/ConfigRepo');

function makeServer(id = 'srv-1', name = 'My Tomcat'): ServerConfig {
  return {
    id,
    name,
    type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/opt/tomcat', version: '10.1' },
    instancePath: '/tmp/inst',
    javaHome: '/usr/lib/jvm/java-17',
    host: '127.0.0.1',
    ports: { http: 8080, debug: 5005 },
    run: { env: {}, vmArgs: [] },
    debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
    deployments: [],
    autosync: { enabled: true, debounceMs: 400, maxBatchFiles: 200, maxBatchBytes: 20_000_000, stormBackoffMs: 2000, ignoreGlobs: [] },
    hooks: [],
  };
}

function makeDeployment(id = 'dep-1', name = 'myapp'): DeploymentConfig {
  return {
    id,
    type: 'exploded',
    sourcePath: '/src/app',
    deployName: name,
    syncMode: 'auto',
    hotReload: false,
    ignoreGlobs: [],
    hooks: [],
  };
}

function makeHook(overrides: Partial<HookConfig> = {}): HookConfig {
  return {
    id: 'hook-1',
    enabled: true,
    phase: 'pre',
    event: 'lifecycle.start',
    kind: 'command',
    timeoutMs: 60_000,
    continueOnError: false,
    command: { mode: 'shell', line: 'echo hook' },
    ...overrides,
  };
}

function createServerNode(server = makeServer()): InstanceType<typeof ServerNode> {
  return new ServerNode(server, 'stopped');
}

/** ServerNode with workspace folder set (for duplicate command tests). */
function createServerNodeWithWorkspace(
  workspaceFolderUri: string,
  server = makeServer(),
): InstanceType<typeof ServerNode> {
  return new ServerNode(
    {
      workspaceFolderUri,
      workspaceFolderName: 'test-ws',
      workspaceFolderFsPath: '/test-ws',
      serverId: server.id,
      serverKey: server.id,
      config: server,
    },
    'stopped',
  );
}

function mockDeps() {
  return {
    lifecycle: {
      start: vi.fn(() => ok(undefined)),
      stop: vi.fn(() => ok(undefined)),
      restart: vi.fn(() => ok(undefined)),
      attachDebug: vi.fn(() => ok(undefined)),
      detachDebug: vi.fn(() => ok(undefined)),
      cancel: vi.fn(),
      enqueueDeployUndeployed: vi.fn(() => ok(undefined)),
      enqueueRedeployAll: vi.fn(() => ok(undefined)),
      enqueueRunDeploymentHealthChecks: vi.fn(() => ok(undefined)),
      waitUntilQueueIdle: vi.fn(async () => {}),
      getAndClearQueueDrainFailure: vi.fn(() => undefined),
      refreshStatus: vi.fn(() => ok(undefined)),
      getServerKeysInState: vi.fn(() => []),
    },
    pluginRegistry: {
      get: vi.fn(() => ({
        getConfigSources: vi.fn(async () => ok([])),
      })),
    },
    workspaceRegistry: {
      addServer: vi.fn(async () => ok(undefined)),
      getServer: vi.fn(() => undefined),
      getEntry: vi.fn(),
      getWorkspaceScopes: vi.fn(() => [{ uri: 'file:///ws', name: 'ws', fsPath: '/ws' }]),
      getServers: vi.fn(() => []),
    },
    configService: {
      getServer: vi.fn((_id: string) => makeServer(_id)),
      reload: vi.fn(),
    },
    provisioningService: {
      removeServer: vi.fn(),
    },
    diagnosticsService: {
      generateBundleText: vi.fn(() => 'diag'),
    },
    logChannel: {
      getChannel: vi.fn(() => ({
        append: vi.fn(),
        appendLine: vi.fn(),
        clear: vi.fn(),
      })),
      showLogs: vi.fn(),
    },
    hookRunner: {
      runHooks: vi.fn(async () => ok({
        executed: 1,
        skipped: 0,
        failed: 0,
        errors: [],
      })),
    },
    treeProvider: {
      requestRefresh: vi.fn(),
      forceRefresh: vi.fn(),
    },
    schemaValidator: {
      validate: vi.fn(() => ok(undefined)),
    },
    serverFormPanel: {
      open: vi.fn(),
      openCreate: vi.fn(),
      openEdit: vi.fn(),
    },
  };
}

describe('Server Commands', () => {
  let deps: ReturnType<typeof mockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(registeredHandlers).forEach(key => delete registeredHandlers[key]);
    mockAccess.mockResolvedValue(undefined);
    deps = mockDeps();
    registerServerCommands(deps as any);
  });

  function invoke(commandId: string, arg?: unknown): unknown {
    const handler = registeredHandlers[commandId];
    if (!handler) {
      throw new Error(`Command ${commandId} not registered`);
    }
    return handler(arg);
  }

  it('registers the Tomcat config command', () => {
    expect(registeredHandlers['jsm.server.openConfig']).toBeDefined();
  });

  it('registers every server command surface exposed by the command module', () => {
    const expected = [
      'jsm.server.add',
      'jsm.hook.test',
      'jsm.server.startRun',
      'jsm.server.startDebug',
      'jsm.server.stop',
      'jsm.server.restartRun',
      'jsm.server.restartDebug',
      'jsm.server.attachDebug',
      'jsm.server.detachDebug',
      'jsm.server.cancelOperation',
      'jsm.server.showLogs',
      'jsm.server.edit',
      'jsm.server.duplicate',
      'jsm.server.remove',
      'jsm.server.openFolder',
      'jsm.server.openConfig',
      'jsm.server.redeployAll',
      'jsm.view.refresh',
      'jsm.server.export',
      'jsm.server.import',
    ];

    for (const id of expected) {
      expect(registeredHandlers[id], `Missing: ${id}`).toBeDefined();
    }
  });

  it('opens the only available Tomcat config file directly', async () => {
    deps.pluginRegistry.get.mockReturnValue({
      getConfigSources: vi.fn(async () => ok([
        {
          id: 'instance-server-xml',
          title: 'server.xml',
          kind: 'file',
          path: '/tmp/inst/conf/server.xml',
          description: 'Instance config',
        },
      ])),
    });

    await invoke('jsm.server.openConfig', createServerNode());

    expect(mockShowQuickPick).not.toHaveBeenCalled();
    expect(mockOpenTextDocument).toHaveBeenCalledWith({ fsPath: '/tmp/inst/conf/server.xml', path: '/tmp/inst/conf/server.xml' });
    expect(mockShowTextDocument).toHaveBeenCalled();
  });

  it('shows a picker when multiple Tomcat config files are available', async () => {
    deps.pluginRegistry.get.mockReturnValue({
      getConfigSources: vi.fn(async () => ok([
        {
          id: 'instance-server-xml',
          title: 'server.xml',
          kind: 'file',
          path: '/tmp/inst/conf/server.xml',
          description: 'Instance config',
        },
        {
          id: 'runtime-web-xml',
          title: 'web.xml',
          kind: 'file',
          path: '/opt/tomcat/conf/web.xml',
          description: 'Runtime config',
        },
      ])),
    });
    mockShowQuickPick.mockResolvedValue({
      label: 'web.xml',
      description: 'Runtime config',
      detail: '/opt/tomcat/conf/web.xml',
      candidate: {
        label: 'web.xml',
        description: 'Runtime config',
        detail: 'Original Tomcat runtime default web application configuration',
        path: '/opt/tomcat/conf/web.xml',
      },
    });

    await invoke('jsm.server.openConfig', createServerNode());

    expect(mockShowQuickPick).toHaveBeenCalledOnce();
    expect(mockOpenTextDocument).toHaveBeenCalledWith({ fsPath: '/opt/tomcat/conf/web.xml', path: '/opt/tomcat/conf/web.xml' });
  });

  it('reports an error when no Tomcat config file exists', async () => {
    deps.pluginRegistry.get.mockReturnValue({
      getConfigSources: vi.fn(async () => ok([])),
    });

    await invoke('jsm.server.openConfig', createServerNode());

    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('No editable configuration files were found'),
    );
    expect(mockOpenTextDocument).not.toHaveBeenCalled();
  });

  describe('jsm.server.showLogs', () => {
    it('shows logs for tree ServerNode', () => {
      const node = createServerNodeWithWorkspace('file:///ws');
      invoke('jsm.server.showLogs', node);
      expect(deps.logChannel.showLogs).toHaveBeenCalledWith(node.serverKey, node.serverConfig.name);
    });

    it('shows logs for SPA-shaped arg with resolved server name', () => {
      const srv = makeServer('srv-2', 'SpaTomcat');
      deps.workspaceRegistry.getServer.mockReturnValue(srv);
      invoke('jsm.server.showLogs', {
        serverId: 'srv-2',
        workspaceFolderUri: 'file:///ws',
        serverKey: 'file:///ws::srv-2',
      });
      expect(deps.logChannel.showLogs).toHaveBeenCalledWith('file:///ws::srv-2', 'SpaTomcat');
    });

    it('does nothing when arg is not a server context', () => {
      invoke('jsm.server.showLogs', undefined);
      expect(deps.logChannel.showLogs).not.toHaveBeenCalled();
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('requires a server selected'),
      );
    });
  });

  describe('jsm.hook.test', () => {
    it('runs a validated hook against the selected workspace server after confirmation', async () => {
      const srv = makeServer('srv-1', 'Hookable Tomcat');
      deps.workspaceRegistry.getServer.mockReturnValue(srv);
      mockShowWarningMessage.mockResolvedValue('Run Hook');

      const result = await invoke('jsm.hook.test', {
        serverId: 'srv-1',
        serverKey: 'file:///ws::srv-1',
        workspaceFolderUri: 'file:///ws',
        hook: makeHook({ enabled: false }),
      });

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Run hook "hook-1"'),
        { modal: true },
        'Run Hook',
      );
      expect(deps.logChannel.showLogs).toHaveBeenCalledWith('file:///ws::srv-1', 'Hookable Tomcat');
      expect(deps.hookRunner.runHooks).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'pre',
        event: 'lifecycle.start',
        hooks: [expect.objectContaining({ id: 'hook-1', enabled: true })],
      }));
      expect(result).toEqual({
        ok: true,
        message: 'Hook "hook-1" completed.',
      });
    });

    it('fails closed before confirmation when the hook payload is invalid', async () => {
      const result = await invoke('jsm.hook.test', {
        serverId: 'srv-1',
        serverKey: 'file:///ws::srv-1',
        workspaceFolderUri: 'file:///ws',
        hook: makeHook({ command: { mode: 'shell', line: '' } }),
      });

      expect(mockShowWarningMessage).not.toHaveBeenCalled();
      expect(deps.hookRunner.runHooks).not.toHaveBeenCalled();
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Hook cannot be tested until it is valid'),
      );
      expect(result).toEqual({
        ok: false,
        message: 'Invalid hook test request.',
      });
    });

    it('surfaces hook runner errors without hiding workspace trust failures', async () => {
      const srv = makeServer('srv-1', 'Hookable Tomcat');
      deps.workspaceRegistry.getServer.mockReturnValue(srv);
      mockShowWarningMessage.mockResolvedValue('Run Hook');
      deps.hookRunner.runHooks.mockResolvedValue(err(new JsmError({
        code: ErrorCode.WorkspaceUntrusted,
        message: 'Hooks are disabled in untrusted workspaces.',
      })));

      const result = await invoke('jsm.hook.test', {
        serverId: 'srv-1',
        serverKey: 'file:///ws::srv-1',
        workspaceFolderUri: 'file:///ws',
        hook: makeHook(),
      });

      expect(result).toEqual({
        ok: false,
        message: 'Hooks are disabled in untrusted workspaces.',
      });
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Hooks are disabled in untrusted workspaces.'),
      );
    });
  });

  describe('SPA-shaped lifecycle args', () => {
    it('jsm.server.startRun uses workspace key when serverKey omitted', async () => {
      const srv = makeServer('srv-1', 'Tom');
      deps.workspaceRegistry.getServer.mockReturnValue(srv);
      deps.lifecycle.start.mockReturnValue(ok(undefined));
      await invoke('jsm.server.startRun', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });
      expect(deps.lifecycle.start).toHaveBeenCalledWith(
        makeWorkspaceServerKey('file:///ws', 'srv-1'),
        'run',
      );
    });

    it('jsm.server.startRun prepares deployments before starting when deployments exist', async () => {
      const srv = makeServer('srv-1', 'Tom');
      srv.deployments = [makeDeployment()];
      deps.workspaceRegistry.getServer.mockReturnValue(srv);

      await invoke('jsm.server.startRun', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });

      const serverKey = makeWorkspaceServerKey('file:///ws', 'srv-1');
      expect(deps.lifecycle.enqueueDeployUndeployed).toHaveBeenCalledWith(serverKey);
      expect(deps.lifecycle.start).toHaveBeenCalledWith(serverKey, 'run');
      expect(mockWithProgress).toHaveBeenCalledTimes(2);
      expect(mockWithProgress.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        title: 'Preparing deployments for Tom...',
      }));
      expect(mockWithProgress.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
        title: 'Starting Tom...',
      }));
    });

    it('jsm.server.startDebug stops before start when deployment preparation fails', async () => {
      const srv = makeServer('srv-1', 'Tom');
      srv.deployments = [makeDeployment()];
      deps.workspaceRegistry.getServer.mockReturnValue(srv);
      deps.lifecycle.enqueueDeployUndeployed.mockReturnValue(
        err(new JsmError({ code: ErrorCode.DeployFailed, message: 'prep failed' })),
      );

      await invoke('jsm.server.startDebug', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });

      expect(deps.lifecycle.start).not.toHaveBeenCalled();
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('prep failed'),
      );
    });

    it('jsm.server.startRun surfaces queue drain failure after waiting for the queued lifecycle op', async () => {
      const srv = makeServer('srv-1', 'Tom');
      deps.workspaceRegistry.getServer.mockReturnValue(srv);
      deps.lifecycle.getAndClearQueueDrainFailure.mockReturnValue(
        new JsmError({ code: ErrorCode.ProcessSpawnFailed, message: 'start failed' }),
      );

      await invoke('jsm.server.startRun', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });

      const serverKey = makeWorkspaceServerKey('file:///ws', 'srv-1');
      expect(deps.lifecycle.start).toHaveBeenCalledWith(serverKey, 'run');
      expect(deps.lifecycle.waitUntilQueueIdle).toHaveBeenCalledWith(serverKey);
      expect(deps.lifecycle.getAndClearQueueDrainFailure).toHaveBeenCalledWith(serverKey);
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('start failed'),
      );
    });

    it('jsm.server.startRun reports a missing server selection instead of silently no-oping', async () => {
      await invoke('jsm.server.startRun', undefined);

      expect(deps.lifecycle.start).not.toHaveBeenCalled();
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('requires a server selected'),
      );
    });

    it('jsm.server.restartRun enqueues a run restart for SPA-shaped args', async () => {
      const srv = makeServer('srv-1', 'Tom');
      deps.workspaceRegistry.getServer.mockReturnValue(srv);

      await invoke('jsm.server.restartRun', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });

      expect(deps.lifecycle.restart).toHaveBeenCalledWith(
        makeWorkspaceServerKey('file:///ws', 'srv-1'),
        'run',
      );
      expect(mockWithProgress).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Restarting Tom...' }),
        expect.any(Function),
      );
    });

    it('jsm.server.restartDebug enqueues a debug restart for SPA-shaped args', async () => {
      const srv = makeServer('srv-1', 'Tom');
      deps.workspaceRegistry.getServer.mockReturnValue(srv);

      await invoke('jsm.server.restartDebug', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });

      expect(deps.lifecycle.restart).toHaveBeenCalledWith(
        makeWorkspaceServerKey('file:///ws', 'srv-1'),
        'debug',
      );
      expect(mockWithProgress).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Restarting Tom (debug)...' }),
        expect.any(Function),
      );
    });

    it('jsm.server.attachDebug delegates to lifecycle and surfaces success', async () => {
      const srv = makeServer('srv-1', 'Tom');
      deps.workspaceRegistry.getServer.mockReturnValue(srv);

      await invoke('jsm.server.attachDebug', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });

      expect(deps.lifecycle.attachDebug).toHaveBeenCalledWith(makeWorkspaceServerKey('file:///ws', 'srv-1'));
      expect(mockShowInfoMessage).toHaveBeenCalledWith('Debugger attached.');
    });

    it('jsm.server.detachDebug delegates to lifecycle and surfaces failures', async () => {
      const srv = makeServer('srv-1', 'Tom');
      deps.workspaceRegistry.getServer.mockReturnValue(srv);
      deps.lifecycle.detachDebug.mockReturnValue(err(new JsmError({
        code: ErrorCode.NotRunning,
        message: 'No debug session is attached.',
      })));

      await invoke('jsm.server.detachDebug', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });

      expect(deps.lifecycle.detachDebug).toHaveBeenCalledWith(makeWorkspaceServerKey('file:///ws', 'srv-1'));
      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('No debug session is attached.'));
    });

    it('jsm.server.cancelOperation cancels the workspace-scoped queue', () => {
      invoke('jsm.server.cancelOperation', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });

      expect(deps.lifecycle.cancel).toHaveBeenCalledWith(makeWorkspaceServerKey('file:///ws', 'srv-1'));
    });
  });

  describe('dashboard entry points', () => {
    it('jsm.server.add should open the dashboard create flow when called without args', async () => {
      await invoke('jsm.server.add');

      expect(mockExecuteCommand).toHaveBeenCalledWith('jsm.dashboard.open', {
        type: 'new-server',
        globalTab: 'home',
      });
    });

    it('jsm.server.edit should open the dashboard server detail view', async () => {
      const node = {
        serverId: 'srv-1',
        serverKey: 'file:///ws::srv-1',
        workspaceFolderUri: 'file:///ws',
      };

      await invoke('jsm.server.edit', node);

      expect(mockExecuteCommand).toHaveBeenCalledWith('jsm.dashboard.open', {
        type: 'server',
        id: 'file:///ws::srv-1',
        serverId: 'srv-1',
        serverKey: 'file:///ws::srv-1',
        workspaceFolderUri: 'file:///ws',
        globalTab: 'home',
      });
    });

    it('jsm.server.add should provision a server from the canonical server draft payload', async () => {
      const createdServer = makeServer('srv-2', 'Created Server');
      const createServer = vi.fn(async () => ok(createdServer));
      deps.workspaceRegistry.getEntry.mockReturnValue({
        provisioningService: { createServer },
      });

      const result = await invoke('jsm.server.add', {
        workspaceFolderUri: 'file:///ws',
        draft: {
          name: 'Created Server',
          type: 'tomcat',
          runtimeHomePath: '/opt/tomcat',
          javaHome: '/usr/lib/jvm/java-17',
          host: '127.0.0.1',
          httpPort: 8080,
          debugPort: 5005,
          debugBind: '127.0.0.1',
          vmArgs: ['-Xmx512m'],
          hooks: [],
          pluginConfig: {
            type: 'tomcat',
            ssl: {
              enabled: true,
              port: 8443,
              keystorePath: '/tmp/server.p12',
              keystorePassword: 'secret',
              keystoreType: 'PKCS12',
            },
          },
        },
      });

      expect(deps.workspaceRegistry.getEntry).toHaveBeenCalledWith('file:///ws');
      expect(createServer).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Created Server',
        type: 'tomcat',
        runtimeHomePath: '/opt/tomcat',
        javaHome: '/usr/lib/jvm/java-17',
        host: '127.0.0.1',
        httpPort: 8080,
        debugPort: 5005,
        debugBind: '127.0.0.1',
        vmArgs: ['-Xmx512m'],
        hooks: [],
        pluginConfig: expect.objectContaining({
          type: 'tomcat',
          ssl: expect.objectContaining({
            enabled: true,
            port: 8443,
            keystorePath: '/tmp/server.p12',
          }),
        }),
      }));
      expect(deps.treeProvider.requestRefresh).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        ok: true,
        data: expect.objectContaining({
          serverId: 'srv-2',
          serverKey: 'file:///ws::srv-2',
          workspaceFolderUri: 'file:///ws',
        }),
      }));
    });

    it('jsm.server.add should surface untrusted-workspace errors from provisioning', async () => {
      const createServer = vi.fn(async () => err(new JsmError({
        code: ErrorCode.WorkspaceUntrusted,
        message: 'Grant workspace trust to provision managed servers.',
      })));
      deps.workspaceRegistry.getEntry.mockReturnValue({
        provisioningService: { createServer },
      });

      const result = await invoke('jsm.server.add', {
        workspaceFolderUri: 'file:///ws',
        draft: {
          name: 'Created Server',
          type: 'tomcat',
          runtimeHomePath: '/opt/tomcat',
          javaHome: '/usr/lib/jvm/java-17',
          host: '127.0.0.1',
          httpPort: 8080,
          debugPort: 5005,
          debugBind: '127.0.0.1',
          vmArgs: [],
          hooks: [],
        },
      });

      expect(result).toEqual({
        ok: false,
        message: 'Grant workspace trust to provision managed servers.',
      });
      expect(deps.treeProvider.requestRefresh).not.toHaveBeenCalled();
    });
  });

  describe('jsm.server.duplicate', () => {
    const workspaceUri = 'file:///test-ws';

    it('calls entry.provisioningService.duplicateServer and refreshes (new instance)', async () => {
      const server = makeServer('srv-1', 'My Server');
      const duplicatedConfig = { ...server, id: 'srv-2', name: 'My Server (Copy)', instancePath: '/managed/srv-2' };
      const mockDuplicate = vi.fn(async () => ok(duplicatedConfig));
      deps.workspaceRegistry.getEntry.mockReturnValue({
        provisioningService: { duplicateServer: mockDuplicate },
      });
      const node = createServerNodeWithWorkspace(workspaceUri, server);

      await invoke('jsm.server.duplicate', node);

      expect(deps.workspaceRegistry.getEntry).toHaveBeenCalledWith(workspaceUri);
      expect(mockDuplicate).toHaveBeenCalledTimes(1);
      expect(mockDuplicate).toHaveBeenCalledWith(server);
      expect(mockShowInfoMessage).toHaveBeenCalledWith(expect.stringContaining('added'));
      expect(mockShowInfoMessage).toHaveBeenCalledWith(expect.stringContaining('instance'));
      expect(deps.treeProvider.requestRefresh).toHaveBeenCalled();
    });

    it('shows error and does not refresh when duplicateServer fails', async () => {
      deps.workspaceRegistry.getEntry.mockReturnValue({
        provisioningService: {
          duplicateServer: vi.fn(async () => err(new JsmError({ code: ErrorCode.InvalidConfig, message: 'Validation failed' }))),
        },
      });
      const node = createServerNodeWithWorkspace(workspaceUri);
      await invoke('jsm.server.duplicate', node);

      expect(mockShowErrorMessage).toHaveBeenCalled();
      expect(deps.treeProvider.requestRefresh).not.toHaveBeenCalled();
    });

    it('shows error when workspace entry not found', async () => {
      deps.workspaceRegistry.getEntry.mockReturnValue(undefined);
      const node = createServerNodeWithWorkspace(workspaceUri);
      await invoke('jsm.server.duplicate', node);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Workspace not found'));
      expect(deps.treeProvider.requestRefresh).not.toHaveBeenCalled();
    });

    it('does nothing when arg is not a ServerNode', async () => {
      deps.workspaceRegistry.getEntry.mockReturnValue({ provisioningService: { duplicateServer: vi.fn() } });
      await invoke('jsm.server.duplicate', undefined);
      expect(deps.workspaceRegistry.getEntry).not.toHaveBeenCalled();
    });

    it('shows error when workspaceRegistry is not available', async () => {
      const depsWithoutRegistry = mockDeps();
      delete (depsWithoutRegistry as any).workspaceRegistry;
      Object.keys(registeredHandlers).forEach(key => delete registeredHandlers[key]);
      registerServerCommands(depsWithoutRegistry as any);

      const node = createServerNodeWithWorkspace(workspaceUri);
      await invoke('jsm.server.duplicate', node);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('workspace registry'),
      );
    });
  });

  describe('jsm.server.remove', () => {
    it('removes through provisioning cleanup after confirmation', async () => {
      const removeServer = vi.fn(async () => ok(undefined));
      deps.workspaceRegistry.getEntry.mockReturnValue({
        provisioningService: { removeServer },
      });
      mockShowWarningMessage.mockResolvedValue('Remove');
      const node = createServerNodeWithWorkspace('file:///ws', makeServer('srv-1', 'Removable'));

      await invoke('jsm.server.remove', node);

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Remove server "Removable"'),
        { modal: true },
        'Remove',
      );
      expect(removeServer).toHaveBeenCalledWith('srv-1');
      expect(deps.treeProvider.requestRefresh).toHaveBeenCalled();
    });

    it('does not remove when the user cancels confirmation', async () => {
      const removeServer = vi.fn(async () => ok(undefined));
      deps.workspaceRegistry.getEntry.mockReturnValue({
        provisioningService: { removeServer },
      });
      mockShowWarningMessage.mockResolvedValue(undefined);

      await invoke('jsm.server.remove', createServerNodeWithWorkspace('file:///ws'));

      expect(removeServer).not.toHaveBeenCalled();
      expect(deps.treeProvider.requestRefresh).not.toHaveBeenCalled();
    });

    it('surfaces a workspace lookup failure instead of silently dropping removal', async () => {
      deps.workspaceRegistry.getEntry.mockReturnValue(undefined);
      mockShowWarningMessage.mockResolvedValue('Remove');

      await invoke('jsm.server.remove', createServerNodeWithWorkspace('file:///missing'));

      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Workspace not found'));
      expect(deps.treeProvider.requestRefresh).not.toHaveBeenCalled();
    });
  });

  describe('jsm.server.redeployAll', () => {
    it('enqueues redeploy all for servers with configured deployments', async () => {
      const srv = makeServer('srv-1', 'Tom');
      srv.deployments = [makeDeployment()];
      deps.workspaceRegistry.getServer.mockReturnValue(srv);

      await invoke('jsm.server.redeployAll', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });

      const serverKey = makeWorkspaceServerKey('file:///ws', 'srv-1');
      expect(deps.lifecycle.enqueueRedeployAll).toHaveBeenCalledWith(serverKey);
      expect(mockShowInfoMessage).toHaveBeenCalledWith(expect.stringContaining('Redeploy All completed'));
    });

    it('does not enqueue redeploy all when no deployments exist', async () => {
      deps.workspaceRegistry.getServer.mockReturnValue(makeServer('srv-1', 'Tom'));

      await invoke('jsm.server.redeployAll', {
        serverId: 'srv-1',
        workspaceFolderUri: 'file:///ws',
      });

      expect(deps.lifecycle.enqueueRedeployAll).not.toHaveBeenCalled();
    });
  });

  describe('jsm.server.export', () => {
    it('shows error when workspaceRegistry is not available', async () => {
      const depsWithoutRegistry = mockDeps();
      delete (depsWithoutRegistry as any).workspaceRegistry;
      Object.keys(registeredHandlers).forEach(key => delete registeredHandlers[key]);
      registerServerCommands(depsWithoutRegistry as any);
      await invoke('jsm.server.export');
      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Export is only available'));
    });

    it('shows info and does not write when workspace has no servers', async () => {
      deps.workspaceRegistry.getWorkspaceScopes.mockReturnValue([{ uri: 'file:///ws', name: 'ws', fsPath: '/ws' }]);
      deps.workspaceRegistry.getServers.mockReturnValue([]);
      await invoke('jsm.server.export');
      expect(mockShowInfoMessage).toHaveBeenCalledWith(expect.stringContaining('No servers to export'));
      expect(mockShowSaveDialog).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('does not write when user cancels save dialog', async () => {
      const server = makeServer();
      deps.workspaceRegistry.getWorkspaceScopes.mockReturnValue([{ uri: 'file:///ws', name: 'ws', fsPath: '/ws' }]);
      deps.workspaceRegistry.getServers.mockReturnValue([{ config: server }]);
      mockShowSaveDialog.mockResolvedValue(undefined);
      await invoke('jsm.server.export');
      expect(mockShowSaveDialog).toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('writes JSON and shows success when user selects path', async () => {
      const server = makeServer('srv-1', 'My Tomcat');
      deps.workspaceRegistry.getWorkspaceScopes.mockReturnValue([{ uri: 'file:///ws', name: 'ws', fsPath: '/ws' }]);
      deps.workspaceRegistry.getServers.mockReturnValue([{ config: server }]);
      const saveUri = { fsPath: '/out/export.json' };
      mockShowSaveDialog.mockResolvedValue(saveUri);
      mockWriteFile.mockResolvedValue(undefined);
      await invoke('jsm.server.export');
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/out/export.json',
        JSON.stringify({ version: CURRENT_WORKSPACE_CONFIG_VERSION, servers: [server] }, null, 2),
        'utf8',
      );
      expect(mockShowInfoMessage).toHaveBeenCalledWith(expect.stringContaining('exported to'));
    });
  });

  describe('jsm.server.import', () => {
    it('shows error when workspaceRegistry is not available', async () => {
      const depsWithoutRegistry = mockDeps();
      delete (depsWithoutRegistry as any).workspaceRegistry;
      Object.keys(registeredHandlers).forEach(key => delete registeredHandlers[key]);
      registerServerCommands(depsWithoutRegistry as any);
      await invoke('jsm.server.import');
      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Import is only available'));
    });

    it('shows error when schemaValidator is not available', async () => {
      const depsWithoutValidator = mockDeps();
      delete (depsWithoutValidator as any).schemaValidator;
      Object.keys(registeredHandlers).forEach(key => delete registeredHandlers[key]);
      registerServerCommands(depsWithoutValidator as any);
      await invoke('jsm.server.import');
      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('schema validator'));
    });

    it('does nothing when user cancels open dialog', async () => {
      mockShowOpenDialog.mockResolvedValue(undefined);
      await invoke('jsm.server.import');
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('shows error for invalid JSON', async () => {
      mockShowOpenDialog.mockResolvedValue([{ fsPath: '/f.json' }]);
      mockReadFile.mockResolvedValue('not json');
      await invoke('jsm.server.import');
      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'));
      expect(deps.workspaceRegistry.getEntry).not.toHaveBeenCalled();
    });

    it('shows error for invalid format (no servers array)', async () => {
      mockShowOpenDialog.mockResolvedValue([{ fsPath: '/f.json' }]);
      mockReadFile.mockResolvedValue('{"other": true}');
      await invoke('jsm.server.import');
      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Invalid format'));
      expect(deps.workspaceRegistry.getEntry).not.toHaveBeenCalled();
    });

    it('shows error when schema validation fails', async () => {
      mockShowOpenDialog.mockResolvedValue([{ fsPath: '/f.json' }]);
      mockReadFile.mockResolvedValue(JSON.stringify({ servers: [makeServer()] }));
      deps.schemaValidator.validate.mockReturnValue(err(new JsmError({ code: ErrorCode.InvalidConfig, message: 'Schema error' })));
      await invoke('jsm.server.import');
      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('JSM:'));
      expect(deps.workspaceRegistry.getEntry).not.toHaveBeenCalled();
    });

    it('shows info when file has no servers', async () => {
      mockShowOpenDialog.mockResolvedValue([{ fsPath: '/f.json' }]);
      mockReadFile.mockResolvedValue(JSON.stringify({ servers: [] }));
      deps.schemaValidator.validate.mockReturnValue(ok(undefined));
      await invoke('jsm.server.import');
      expect(mockShowInfoMessage).toHaveBeenCalledWith(expect.stringContaining('No servers in file'));
      expect(deps.workspaceRegistry.getEntry).not.toHaveBeenCalled();
    });

    it('previews the import plan, applies planned duplicates after confirmation, and refreshes', async () => {
      const server = makeServer('srv-1', 'My Tomcat');
      const planned = { ...server, id: 'srv-2', instancePath: '/new' };
      mockShowOpenDialog.mockResolvedValue([{ fsPath: '/f.json' }]);
      mockReadFile.mockResolvedValue(JSON.stringify({ servers: [server] }));
      deps.schemaValidator.validate.mockReturnValue(ok(undefined));
      mockShowQuickPick.mockResolvedValue({ scope: { uri: 'file:///ws', name: 'ws', fsPath: '/ws' } });
      mockShowWarningMessage.mockResolvedValue('Import');
      const mockPlan = vi.fn(async () => ok(planned));
      const mockProvision = vi.fn(async () => ok(planned));
      const mockValidateCandidates = vi.fn(() => ok(undefined));
      deps.workspaceRegistry.getEntry.mockReturnValue({
        provisioningService: {
          planDuplicateServer: mockPlan,
          provisionPlannedDuplicate: mockProvision,
        },
        configService: {
          validateServerCandidates: mockValidateCandidates,
        },
      });
      await invoke('jsm.server.import');
      expect(mockPlan).toHaveBeenCalledTimes(1);
      expect(mockPlan).toHaveBeenCalledWith(server, { keepName: true });
      expect(mockValidateCandidates).toHaveBeenCalledWith([planned]);
      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Import 1 server(s)'),
        expect.objectContaining({
          modal: true,
          detail: expect.stringContaining('Existing servers are not modified'),
        }),
        'Import',
      );
      expect(mockProvision).toHaveBeenCalledWith(server, planned);
      expect(mockShowInfoMessage).toHaveBeenCalledWith(expect.stringContaining('Imported 1 server(s)'));
      expect(deps.treeProvider.requestRefresh).toHaveBeenCalled();
    });

    it('does not provision when the dry-run plan has inventory conflicts', async () => {
      const first = makeServer('srv-1', 'Server One');
      const second = makeServer('srv-2', 'Server Two');
      mockShowOpenDialog.mockResolvedValue([{ fsPath: '/f.json' }]);
      mockReadFile.mockResolvedValue(JSON.stringify({ servers: [first, second] }));
      deps.schemaValidator.validate.mockReturnValue(ok(undefined));
      mockShowQuickPick.mockResolvedValue({ scope: { uri: 'file:///ws', name: 'ws', fsPath: '/ws' } });
      const plannedFirst = { ...first, id: 'dup-1', instancePath: '/new-1' };
      const plannedSecond = { ...second, id: 'dup-2', instancePath: '/new-2' };
      const mockPlan = vi.fn()
        .mockResolvedValueOnce(ok(plannedFirst))
        .mockResolvedValueOnce(ok(plannedSecond));
      const mockProvision = vi.fn(async () => ok(plannedFirst));
      const mockValidateCandidates = vi.fn(() => err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: 'Port 8080 conflicts',
      })));
      deps.workspaceRegistry.getEntry.mockReturnValue({
        provisioningService: {
          planDuplicateServer: mockPlan,
          provisionPlannedDuplicate: mockProvision,
        },
        configService: {
          validateServerCandidates: mockValidateCandidates,
        },
      });

      await invoke('jsm.server.import');

      expect(mockPlan).toHaveBeenCalledTimes(2);
      expect(mockValidateCandidates).toHaveBeenCalledWith([plannedFirst, plannedSecond]);
      expect(mockProvision).not.toHaveBeenCalled();
      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Port 8080 conflicts'));
      expect(mockShowInfoMessage).not.toHaveBeenCalledWith(expect.stringContaining('Imported 1 server(s)'));
      expect(deps.treeProvider.requestRefresh).not.toHaveBeenCalled();
    });

    it('does not provision when the user cancels the dry-run confirmation', async () => {
      const server = makeServer('srv-1', 'My Tomcat');
      const planned = { ...server, id: 'srv-2', instancePath: '/new' };
      mockShowOpenDialog.mockResolvedValue([{ fsPath: '/f.json' }]);
      mockReadFile.mockResolvedValue(JSON.stringify({ servers: [server] }));
      deps.schemaValidator.validate.mockReturnValue(ok(undefined));
      mockShowQuickPick.mockResolvedValue({ scope: { uri: 'file:///ws', name: 'ws', fsPath: '/ws' } });
      mockShowWarningMessage.mockResolvedValue(undefined);
      const mockProvision = vi.fn(async () => ok(planned));
      deps.workspaceRegistry.getEntry.mockReturnValue({
        provisioningService: {
          planDuplicateServer: vi.fn(async () => ok(planned)),
          provisionPlannedDuplicate: mockProvision,
        },
        configService: {
          validateServerCandidates: vi.fn(() => ok(undefined)),
        },
      });

      await invoke('jsm.server.import');

      expect(mockProvision).not.toHaveBeenCalled();
      expect(mockShowInfoMessage).not.toHaveBeenCalledWith(expect.stringContaining('Imported 1 server(s)'));
      expect(deps.treeProvider.requestRefresh).not.toHaveBeenCalled();
    });
  });

  describe('file opening boundaries', () => {
    it('jsm.server.openConfig shows a command-side error when opening the selected file fails', async () => {
      deps.pluginRegistry.get.mockReturnValue({
        getConfigSources: vi.fn(async () => ok([
          {
            id: 'instance-server-xml',
            title: 'server.xml',
            kind: 'file',
            path: '/tmp/inst/conf/server.xml',
            description: 'Instance config',
          },
        ])),
      });
      mockOpenTextDocument.mockRejectedValue(new Error('open failed'));

      await invoke('jsm.server.openConfig', createServerNode());

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('open failed'),
      );
    });

    it('jsm.server.openFolder shows a command-side error when revealFileInOS fails', async () => {
      const server = {
        ...makeServer(),
        instancePath: path.dirname(process.cwd()),
      };
      mockExecuteCommand.mockRejectedValue(new Error('reveal failed'));

      await invoke('jsm.server.openFolder', createServerNodeWithWorkspace('file:///ws', server));

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'revealFileInOS',
        expect.objectContaining({ fsPath: path.dirname(process.cwd()) }),
      );
      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('reveal failed'),
      );
    });
  });
});

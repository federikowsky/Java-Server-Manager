/**
 * Exhaustive test suite: Server Commands
 *
 * Categories: happy path, negative path, edge cases, alternate flows,
 * concurrency, stateful/lifecycle, security (type guard bypass attempts)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerConfig, DeploymentConfig } from '@core/types/domain';
import type { Logger } from '@core/types/logger';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { ok, err } from '@core/result';

/* ══════════════════════════════════════════════════════════════════════════
 * VS Code mock
 * ══════════════════════════════════════════════════════════════════════════ */

const mockShowErrorMessage = vi.fn();
const mockShowInfoMessage = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockRegisterCommand = vi.fn((_id: string, handler: (...args: unknown[]) => unknown) => {
  registeredHandlers[_id] = handler;
  return { dispose: vi.fn() };
});
const mockShowTextDocument = vi.fn();
const mockOpenTextDocument = vi.fn();
const mockWriteText = vi.fn();

const registeredHandlers: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: mockShowErrorMessage,
    showInformationMessage: mockShowInfoMessage,
    showWarningMessage: mockShowWarningMessage,
    showTextDocument: mockShowTextDocument,
    createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
    createWebviewPanel: vi.fn(),
  },
  commands: {
    registerCommand: mockRegisterCommand,
  },
  workspace: {
    openTextDocument: mockOpenTextDocument,
    isTrusted: true,
  },
  env: {
    clipboard: { writeText: mockWriteText },
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, path: p }),
  },
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

/* ══════════════════════════════════════════════════════════════════════════
 * Imports (after mock)
 * ══════════════════════════════════════════════════════════════════════════ */

const { registerServerCommands } = await import('@ui/commands/server-commands');
const { ServerNode, DeploymentNode } = await import('@ui/tree/ServerTreeViewProvider');

/* ══════════════════════════════════════════════════════════════════════════
 * Helpers
 * ══════════════════════════════════════════════════════════════════════════ */

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
    autosync: {
      enabled: true, debounceMs: 400, maxBatchFiles: 200,
      maxBatchBytes: 20_000_000, stormBackoffMs: 2000, ignoreGlobs: [],
    },
    hooks: [],
  };
}

function makeDeployment(id = 'dep-1'): DeploymentConfig {
  return {
    id, type: 'exploded', sourcePath: '/src/app', deployName: 'myapp',
    syncMode: 'auto', ignoreGlobs: [], hooks: [],
  };
}

function createServerNode(server = makeServer()): InstanceType<typeof ServerNode> {
  return new ServerNode(server, 'stopped');
}

function createDeploymentNode(serverId = 'srv-1', dep = makeDeployment()): InstanceType<typeof DeploymentNode> {
  return new DeploymentNode(serverId, dep, 'undeployed');
}

function mockDeps() {
  return {
    lifecycle: {
      start: vi.fn((_id: string, _mode: string) => ok(undefined)),
      stop: vi.fn((_id: string) => ok(undefined)),
      restart: vi.fn((_id: string, _mode: string) => ok(undefined)),
      cancel: vi.fn(),
      refreshStatus: vi.fn((_id: string) => ok(undefined)),
    },
    configService: {
      getServer: vi.fn((_id: string) => makeServer(_id)),
      removeServer: vi.fn(async () => ok(undefined)),
      reload: vi.fn(async () => ok([])),
      getAllServers: vi.fn(() => []),
    },
    provisioningService: {
      removeServer: vi.fn(async () => ok(undefined)),
    },
    deployService: {
      redeployAll: vi.fn(async () => ok(undefined)),
    },
    diagnosticsService: {
      generateBundleText: vi.fn(() => 'diagnostics text'),
    },
    logChannel: {
      showLogs: vi.fn(),
    },
    treeProvider: {
      requestRefresh: vi.fn(),
      forceRefresh: vi.fn(),
    },
    serverFormPanel: {
      open: vi.fn(),
    },
    configFilePath: '/workspace/.vscode/jsm.servers.json',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tests
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Server Commands', () => {
  let deps: ReturnType<typeof mockDeps>;
  let disposables: { dispose: () => void }[];

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(registeredHandlers).forEach(k => delete registeredHandlers[k]);
    deps = mockDeps();
    disposables = registerServerCommands(deps as any);
  });

  function invoke(commandId: string, arg?: unknown): unknown {
    const handler = registeredHandlers[commandId];
    if (!handler) throw new Error(`Command ${commandId} not registered`);
    return handler(arg);
  }

  it('should register all expected commands', () => {
    const expected = [
      'jsm.server.add', 'jsm.server.startRun', 'jsm.server.startDebug',
      'jsm.server.stop', 'jsm.server.restartRun', 'jsm.server.restartDebug',
      'jsm.server.cancelOperation', 'jsm.server.refreshStatus', 'jsm.server.edit',
      'jsm.server.duplicate', 'jsm.server.remove', 'jsm.server.openConfig',
      'jsm.server.openHome', 'jsm.server.openLogs', 'jsm.server.syncAllDeployments',
      'jsm.server.fullRedeployAll', 'jsm.view.refresh', 'jsm.diagnostics.copy',
    ];
    for (const id of expected) {
      expect(registeredHandlers[id], `Missing command: ${id}`).toBeDefined();
    }
  });

  it('should return disposables for all commands', () => {
    expect(disposables.length).toBe(20);
    for (const d of disposables) {
      expect(d.dispose).toBeDefined();
    }
  });

  /* ── Happy Path ──────────────────────────────────────────────────────── */

  describe('Happy Path', () => {
    it('jsm.server.add should open server form in create mode', () => {
      invoke('jsm.server.add');
      expect(deps.serverFormPanel.open).toHaveBeenCalledWith('create');
    });

    it('jsm.server.startRun should call lifecycle.start with run mode', () => {
      const node = createServerNode();
      invoke('jsm.server.startRun', node);
      expect(deps.lifecycle.start).toHaveBeenCalledWith('srv-1', 'run');
    });

    it('jsm.server.startDebug should call lifecycle.start with debug mode', () => {
      const node = createServerNode();
      invoke('jsm.server.startDebug', node);
      expect(deps.lifecycle.start).toHaveBeenCalledWith('srv-1', 'debug');
    });

    it('jsm.server.stop should call lifecycle.stop', () => {
      const node = createServerNode();
      invoke('jsm.server.stop', node);
      expect(deps.lifecycle.stop).toHaveBeenCalledWith('srv-1');
    });

    it('jsm.server.restartRun should call lifecycle.restart with run', () => {
      const node = createServerNode();
      invoke('jsm.server.restartRun', node);
      expect(deps.lifecycle.restart).toHaveBeenCalledWith('srv-1', 'run');
    });

    it('jsm.server.restartDebug should call lifecycle.restart with debug', () => {
      const node = createServerNode();
      invoke('jsm.server.restartDebug', node);
      expect(deps.lifecycle.restart).toHaveBeenCalledWith('srv-1', 'debug');
    });

    it('jsm.server.cancelOperation should call lifecycle.cancel', () => {
      const node = createServerNode();
      invoke('jsm.server.cancelOperation', node);
      expect(deps.lifecycle.cancel).toHaveBeenCalledWith('srv-1');
    });

    it('jsm.server.refreshStatus should call lifecycle.refreshStatus', () => {
      const node = createServerNode();
      invoke('jsm.server.refreshStatus', node);
      expect(deps.lifecycle.refreshStatus).toHaveBeenCalledWith('srv-1');
    });

    it('jsm.server.edit should open server form in edit mode', () => {
      const node = createServerNode();
      invoke('jsm.server.edit', node);
      expect(deps.serverFormPanel.open).toHaveBeenCalledWith('edit', 'srv-1');
    });

    it('jsm.server.remove should remove server after confirmation', async () => {
      mockShowWarningMessage.mockResolvedValue('Remove');
      const node = createServerNode();

      await invoke('jsm.server.remove', node);

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Remove server'),
        { modal: true },
        'Remove',
      );
      expect(deps.provisioningService.removeServer).toHaveBeenCalledWith('srv-1');
      expect(deps.treeProvider.requestRefresh).toHaveBeenCalled();
    });

    it('jsm.server.openConfig should open the config file', async () => {
      mockOpenTextDocument.mockResolvedValue({ uri: 'doc' });
      await invoke('jsm.server.openConfig', createServerNode());
      expect(mockOpenTextDocument).toHaveBeenCalled();
      expect(mockShowTextDocument).toHaveBeenCalled();
    });

    it('jsm.server.openLogs should call logChannel.showLogs', () => {
      const node = createServerNode();
      invoke('jsm.server.openLogs', node);
      expect(deps.logChannel.showLogs).toHaveBeenCalledWith('srv-1', 'My Tomcat');
    });

    it('jsm.server.syncAllDeployments should call deployService.redeployAll', async () => {
      const server = makeServer();
      server.deployments = [makeDeployment()];
      deps.configService.getServer.mockReturnValue(server);
      const node = createServerNode(server);

      await invoke('jsm.server.syncAllDeployments', node);

      expect(deps.deployService.redeployAll).toHaveBeenCalled();
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('Sync All completed'),
      );
    });

    it('jsm.server.fullRedeployAll should call deployService.redeployAll', async () => {
      const server = makeServer();
      server.deployments = [makeDeployment()];
      deps.configService.getServer.mockReturnValue(server);
      const node = createServerNode(server);

      await invoke('jsm.server.fullRedeployAll', node);

      expect(deps.deployService.redeployAll).toHaveBeenCalled();
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('Full Redeploy All completed'),
      );
    });

    it('jsm.view.refresh should reload config and force refresh tree', async () => {
      await invoke('jsm.view.refresh');
      expect(deps.configService.reload).toHaveBeenCalled();
      expect(deps.treeProvider.forceRefresh).toHaveBeenCalled();
    });

    it('jsm.diagnostics.copy should copy diagnostics to clipboard', async () => {
      await invoke('jsm.diagnostics.copy');
      expect(mockWriteText).toHaveBeenCalledWith('diagnostics text');
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('Diagnostics copied'),
      );
    });
  });

  /* ── Type Guard: non-ServerNode args ─────────────────────────────────── */

  describe('Type Guard: non-ServerNode arguments', () => {
    const nodeCommands = [
      'jsm.server.startRun', 'jsm.server.startDebug', 'jsm.server.stop',
      'jsm.server.restartRun', 'jsm.server.restartDebug',
      'jsm.server.cancelOperation', 'jsm.server.refreshStatus',
      'jsm.server.edit', 'jsm.server.remove', 'jsm.server.openLogs',
      'jsm.server.syncAllDeployments', 'jsm.server.fullRedeployAll',
    ];

    for (const cmd of nodeCommands) {
      it(`${cmd} should silently return with undefined arg`, () => {
        expect(() => invoke(cmd, undefined)).not.toThrow();
      });

      it(`${cmd} should silently return with null arg`, () => {
        expect(() => invoke(cmd, null)).not.toThrow();
      });

      it(`${cmd} should silently return with plain object (not ServerNode)`, () => {
        expect(() => invoke(cmd, { serverId: 'fake' })).not.toThrow();
      });

      it(`${cmd} should silently return with string arg`, () => {
        expect(() => invoke(cmd, 'srv-1')).not.toThrow();
      });

      it(`${cmd} should silently return with DeploymentNode arg`, () => {
        const depNode = createDeploymentNode();
        expect(() => invoke(cmd, depNode)).not.toThrow();
      });
    }
  });

  /* ── Negative Path ───────────────────────────────────────────────────── */

  describe('Negative Path', () => {
    it('startRun should show error when lifecycle.start fails', () => {
      const jsmErr = new JsmError({ code: ErrorCode.ServerStartFailed, message: 'Port in use' });
      deps.lifecycle.start.mockReturnValue(err(jsmErr));

      const node = createServerNode();
      invoke('jsm.server.startRun', node);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Port in use'),
      );
    });

    it('stop should show error when lifecycle.stop fails', () => {
      const jsmErr = new JsmError({ code: ErrorCode.ServerStopFailed, message: 'Forceful' });
      deps.lifecycle.stop.mockReturnValue(err(jsmErr));

      const node = createServerNode();
      invoke('jsm.server.stop', node);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Forceful'),
      );
    });

    it('refreshStatus should show error when it fails', () => {
      const jsmErr = new JsmError({ code: ErrorCode.ServerNotFound, message: 'Server not found' });
      deps.lifecycle.refreshStatus.mockReturnValue(err(jsmErr));

      const node = createServerNode();
      invoke('jsm.server.refreshStatus', node);

      expect(mockShowErrorMessage).toHaveBeenCalled();
    });

    it('remove should show error when removeServer fails', async () => {
      mockShowWarningMessage.mockResolvedValue('Remove');
      deps.provisioningService.removeServer.mockResolvedValue(
        err(new JsmError({ code: ErrorCode.ConfigWriteFailed, message: 'Lock' })),
      );

      const node = createServerNode();
      await invoke('jsm.server.remove', node);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Lock'),
      );
    });

    it('remove should NOT remove when user cancels dialog', async () => {
      mockShowWarningMessage.mockResolvedValue(undefined);

      const node = createServerNode();
      await invoke('jsm.server.remove', node);

      expect(deps.provisioningService.removeServer).not.toHaveBeenCalled();
    });

    it('syncAllDeployments should do nothing when server has 0 deployments', async () => {
      const server = makeServer();
      server.deployments = [];
      deps.configService.getServer.mockReturnValue(server);
      const node = createServerNode(server);

      await invoke('jsm.server.syncAllDeployments', node);

      expect(deps.deployService.redeployAll).not.toHaveBeenCalled();
    });

    it('syncAllDeployments should do nothing when configService.getServer returns undefined', async () => {
      deps.configService.getServer.mockReturnValue(undefined);
      const node = createServerNode();

      await invoke('jsm.server.syncAllDeployments', node);

      expect(deps.deployService.redeployAll).not.toHaveBeenCalled();
    });
  });

  /* ── Deferred Commands ───────────────────────────────────────────────── */

  describe('Deferred Commands', () => {
    it('jsm.server.duplicate should show deferred message', () => {
      invoke('jsm.server.duplicate');
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('v1.1'),
      );
    });

    it('jsm.server.openHome should show deferred message', () => {
      invoke('jsm.server.openHome');
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('v1.1'),
      );
    });
  });
});

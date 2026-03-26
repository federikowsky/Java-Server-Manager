/**
 * Exhaustive test suite: Deployment Commands
 *
 * Categories: happy path, negative path, edge cases, alternate flows,
 * type guard bypass, stateful lifecycle (toggleAutosync cycling)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerConfig, DeploymentConfig } from '@core/types/domain';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { ok, err } from '@core/result';

/* ══════════════════════════════════════════════════════════════════════════
 * VS Code mock
 * ══════════════════════════════════════════════════════════════════════════ */

const mockShowErrorMessage = vi.fn();
const mockShowInfoMessage = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockOpenTextDocument = vi.fn();
const mockShowTextDocument = vi.fn();
const mockExecuteCommand = vi.fn();
const mockWithProgress = vi.fn(async (_options: unknown, task: (progress: { report: ReturnType<typeof vi.fn> }, token: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => { dispose: ReturnType<typeof vi.fn> } }) => unknown) =>
  task(
    { report: vi.fn() },
    {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: vi.fn() }),
    },
  ),
);
const registeredHandlers: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: mockShowErrorMessage,
    showInformationMessage: mockShowInfoMessage,
    showWarningMessage: mockShowWarningMessage,
    showTextDocument: mockShowTextDocument,
    withProgress: mockWithProgress,
    createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    openTextDocument: mockOpenTextDocument,
  },
  commands: {
    registerCommand: vi.fn((_id: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers[_id] = handler;
      return { dispose: vi.fn() };
    }),
    executeCommand: mockExecuteCommand,
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, path: p }),
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

/* ══════════════════════════════════════════════════════════════════════════
 * Imports (after mock)
 * ══════════════════════════════════════════════════════════════════════════ */

const { registerDeploymentCommands } = await import('@ui/commands/deployment-commands');
const { ServerNode, DeploymentNode } = await import('@ui/tree/ServerTreeViewProvider');

/* ══════════════════════════════════════════════════════════════════════════
 * Helpers
 * ══════════════════════════════════════════════════════════════════════════ */

function makeServer(id = 'srv-1', name = 'My Tomcat'): ServerConfig {
  return {
    id, name, type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/opt/tomcat', version: '10.1' },
    instancePath: '/tmp/inst', javaHome: '/usr/lib/jvm/java-17', host: '127.0.0.1',
    ports: { http: 8080, debug: 5005 },
    run: { env: {}, vmArgs: [] },
    debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
    deployments: [],
    autosync: { enabled: true, debounceMs: 400, maxBatchFiles: 200, maxBatchBytes: 20_000_000, stormBackoffMs: 2000, ignoreGlobs: [] },
    hooks: [],
  };
}

function makeDeployment(id = 'dep-1', syncMode: 'manual' | 'auto' = 'auto', type: 'war' | 'exploded' = 'exploded'): DeploymentConfig {
  return {
    id, type, sourcePath: '/src/app', deployName: 'myapp',
    syncMode, ignoreGlobs: [], hooks: [],
  };
}

function createServerNode(server = makeServer()): InstanceType<typeof ServerNode> {
  return new ServerNode(server, 'stopped');
}

function createDeploymentNode(
  serverId = 'srv-1',
  dep = makeDeployment(),
): InstanceType<typeof DeploymentNode> {
  return new DeploymentNode(serverId, dep, 'undeployed');
}

function mockDeps() {
  const getLogSources = vi.fn(async () => ok<{ primary?: { id: string; title: string; kind: 'file'; path: string }; others: unknown[] }>({ others: [] }));
  return {
    configService: {
      getServer: vi.fn((_id: string) => makeServer(_id)),
      removeDeployment: vi.fn(async () => ok(undefined)),
      updateServer: vi.fn(async () => ok(undefined)),
    },
    pluginRegistry: {
      get: vi.fn(() => ({ getLogSources })),
    },
    lifecycle: {
      enqueueDeployFull: vi.fn(() => ok(undefined)),
      enqueueUndeploy: vi.fn(() => ok(undefined)),
      cancel: vi.fn(),
      waitUntilQueueIdle: vi.fn(async () => {}),
      getAndClearQueueDrainFailure: vi.fn(() => undefined),
    },
    treeProvider: {
      requestRefresh: vi.fn(),
    },
    deploymentFormPanel: {
      open: vi.fn(),
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tests
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Deployment Commands', () => {
  let deps: ReturnType<typeof mockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(registeredHandlers).forEach(k => delete registeredHandlers[k]);
    deps = mockDeps();
    registerDeploymentCommands(deps as any);
  });

  function invoke(commandId: string, arg?: unknown): unknown {
    const handler = registeredHandlers[commandId];
    if (!handler) throw new Error(`Command ${commandId} not registered`);
    return handler(arg);
  }

  it('should register all expected deployment commands', () => {
    const expected = [
      'jsm.deployment.add', 'jsm.deployment.redeploy',
      'jsm.deployment.undeploy', 'jsm.deployment.toggleAutosync',
      'jsm.deployment.configureIgnoreGlobs', 'jsm.deployment.edit',
      'jsm.deployment.remove', 'jsm.deployment.openLogs',
    ];
    for (const id of expected) {
      expect(registeredHandlers[id], `Missing: ${id}`).toBeDefined();
    }
  });

  /* ── Happy Path ──────────────────────────────────────────────────────── */

  describe('Happy Path', () => {
    it('jsm.deployment.add should open the dashboard deployment flow in create mode', () => {
      const node = createServerNode();
      invoke('jsm.deployment.add', node);
      expect(mockExecuteCommand).toHaveBeenCalledWith('jsm.dashboard.open', {
        type: 'deployment',
        serverId: 'srv-1',
        mode: 'create',
        globalTab: 'home',
      });
    });

    it('jsm.deployment.edit should open the dashboard deployment flow in edit mode', () => {
      const node = createDeploymentNode();
      invoke('jsm.deployment.edit', node);
      expect(mockExecuteCommand).toHaveBeenCalledWith('jsm.dashboard.open', {
        type: 'deployment',
        id: 'dep-1',
        serverId: 'srv-1',
        mode: 'edit',
        globalTab: 'home',
      });
    });

    it('jsm.deployment.add should persist a SPA deployment payload and return a command result', async () => {
      const result = await invoke('jsm.deployment.add', {
        serverId: 'srv-1',
        serverKey: 'srv-1',
        workspaceFolderUri: '',
        draft: {
          id: 'dep-2',
          type: 'exploded',
          sourcePath: '/src/app',
          deployName: 'myapp',
          syncMode: 'auto',
          hotReload: false,
          ignoreGlobs: [],
          hooks: [],
        },
      });

      expect(deps.configService.updateServer).toHaveBeenCalledWith(
        expect.objectContaining({
          deployments: [expect.objectContaining({ id: 'dep-2' })],
        }),
      );
      expect(deps.treeProvider.requestRefresh).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        ok: true,
        data: {
          serverId: 'srv-1',
          deploymentId: 'dep-2',
        },
      }));
    });

    it('jsm.deployment.add should surface untrusted-workspace errors from config writes', async () => {
      deps.configService.updateServer.mockResolvedValue(
        err(new JsmError({
          code: ErrorCode.WorkspaceUntrusted,
          message: 'Grant workspace trust to modify deployment configuration.',
        })),
      );

      const result = await invoke('jsm.deployment.add', {
        serverId: 'srv-1',
        serverKey: 'srv-1',
        workspaceFolderUri: '',
        draft: {
          id: 'dep-2',
          type: 'exploded',
          sourcePath: '/src/app',
          deployName: 'myapp',
          syncMode: 'auto',
          hotReload: false,
          ignoreGlobs: [],
          hooks: [],
        },
      });

      expect(result).toEqual({
        ok: false,
        message: 'Grant workspace trust to modify deployment configuration.',
      });
      expect(deps.treeProvider.requestRefresh).not.toHaveBeenCalled();
    });

    it('jsm.deployment.redeploy should enqueue DeployFull on lifecycle', async () => {
      const dep = makeDeployment();
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.redeploy', node);

      expect(deps.lifecycle.enqueueDeployFull).toHaveBeenCalledWith('srv-1', 'dep-1');
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('Redeploy completed'),
      );
    });

    it('jsm.deployment.undeploy should enqueue Undeploy on lifecycle', async () => {
      const dep = makeDeployment();
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.undeploy', node);

      expect(deps.lifecycle.enqueueUndeploy).toHaveBeenCalledWith('srv-1', 'dep-1');
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('Undeployed'),
      );
    });

    it('jsm.deployment.remove should remove after confirmation', async () => {
      mockShowWarningMessage.mockResolvedValue('Remove');

      const node = createDeploymentNode();
      await invoke('jsm.deployment.remove', node);

      expect(deps.configService.removeDeployment).toHaveBeenCalledWith('srv-1', 'dep-1');
      expect(deps.treeProvider.requestRefresh).toHaveBeenCalled();
    });
  });

  /* ── Toggle Autosync Cycling ─────────────────────────────────────────── */

  describe('toggleAutosync cycling', () => {
    it('should cycle manual → auto', async () => {
      const dep = makeDeployment('dep-1', 'manual');
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.toggleAutosync', node);

      expect(deps.configService.updateServer).toHaveBeenCalledWith(
        expect.objectContaining({
          deployments: [expect.objectContaining({ syncMode: 'auto' })],
        }),
      );
    });

    it('should cycle auto → manual', async () => {
      const dep = makeDeployment('dep-1', 'auto');
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.toggleAutosync', node);

      expect(deps.configService.updateServer).toHaveBeenCalledWith(
        expect.objectContaining({
          deployments: [expect.objectContaining({ syncMode: 'manual' })],
        }),
      );
    });

    it('should cycle sync mode for war deployments', async () => {
      const dep = makeDeployment('dep-1', 'manual', 'war');
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.toggleAutosync', node);

      expect(deps.configService.updateServer).toHaveBeenCalledWith(
        expect.objectContaining({
          deployments: [expect.objectContaining({ type: 'war', syncMode: 'auto' })],
        }),
      );
    });

    it('should show error when updateServer fails', async () => {
      const dep = makeDeployment('dep-1', 'manual');
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);
      deps.configService.updateServer.mockResolvedValue(
        err(new JsmError({ code: ErrorCode.ConfigWriteFailed, message: 'fail' })),
      );

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.toggleAutosync', node);

      expect(mockShowErrorMessage).toHaveBeenCalled();
    });
  });

  /* ── Type Guard: non-DeploymentNode args ─────────────────────────────── */

  describe('Type Guard: non-DeploymentNode arguments', () => {
    const depCommands = [
      'jsm.deployment.redeploy', 'jsm.deployment.undeploy',
      'jsm.deployment.toggleAutosync', 'jsm.deployment.edit', 'jsm.deployment.remove',
    ];

    for (const cmd of depCommands) {
      it(`${cmd} should silently return with undefined arg`, () => {
        expect(() => invoke(cmd, undefined)).not.toThrow();
      });

      it(`${cmd} should silently return with plain object (not DeploymentNode)`, () => {
        expect(() => invoke(cmd, { deploymentId: 'fake' })).not.toThrow();
      });

      it(`${cmd} should silently return with ServerNode arg`, () => {
        const serverNode = createServerNode();
        expect(() => invoke(cmd, serverNode)).not.toThrow();
      });
    }

    it('jsm.deployment.add should silently return with DeploymentNode (needs ServerNode)', () => {
      const depNode = createDeploymentNode();
      expect(() => invoke('jsm.deployment.add', depNode)).not.toThrow();
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });
  });

  /* ── Negative Path ───────────────────────────────────────────────────── */

  describe('Negative Path', () => {
    it('redeploy should silently return when server not found', async () => {
      deps.configService.getServer.mockReturnValue(undefined);
      const node = createDeploymentNode();
      await invoke('jsm.deployment.redeploy', node);
      expect(deps.lifecycle.enqueueDeployFull).not.toHaveBeenCalled();
    });

    it('redeploy should silently return when deployment not found in server', async () => {
      const server = makeServer();
      server.deployments = []; // No deployments
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode();
      await invoke('jsm.deployment.redeploy', node);
      expect(deps.lifecycle.enqueueDeployFull).not.toHaveBeenCalled();
    });

    it('redeploy should show error when queued deploy fails', async () => {
      const dep = makeDeployment();
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);
      deps.lifecycle.getAndClearQueueDrainFailure.mockReturnValue(
        new JsmError({ code: ErrorCode.DeployFailed, message: 'Deploy error' }),
      );

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.redeploy', node);

      expect(mockShowErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Deploy error'),
      );
    });

    it('remove should NOT remove when user cancels dialog', async () => {
      mockShowWarningMessage.mockResolvedValue(undefined);
      const node = createDeploymentNode();
      await invoke('jsm.deployment.remove', node);
      expect(deps.configService.removeDeployment).not.toHaveBeenCalled();
    });

    it('remove should show error when removeDeployment fails', async () => {
      mockShowWarningMessage.mockResolvedValue('Remove');
      deps.configService.removeDeployment.mockResolvedValue(
        err(new JsmError({ code: ErrorCode.ConfigWriteFailed, message: 'fail' })),
      );

      const node = createDeploymentNode();
      await invoke('jsm.deployment.remove', node);

      expect(mockShowErrorMessage).toHaveBeenCalled();
    });

    it('remove should resolve deployment details when deploymentConfig is missing on the node', async () => {
      const dep = makeDeployment();
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);
      mockShowWarningMessage.mockResolvedValue('Remove');

      const node = createDeploymentNode('srv-1', dep) as any;
      node.deploymentConfig = undefined;

      await invoke('jsm.deployment.remove', node);

      expect(mockShowWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining(dep.deployName),
        { modal: true },
        'Remove',
      );
      expect(deps.configService.removeDeployment).toHaveBeenCalledWith('srv-1', dep.id);
    });

    it('toggleAutosync should silently return when server not found', async () => {
      deps.configService.getServer.mockReturnValue(undefined);
      const node = createDeploymentNode();
      await invoke('jsm.deployment.toggleAutosync', node);
      expect(deps.configService.updateServer).not.toHaveBeenCalled();
    });

    it('toggleAutosync should silently return when deployment not found in server', async () => {
      const server = makeServer();
      server.deployments = []; // Empty
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode();
      await invoke('jsm.deployment.toggleAutosync', node);
      expect(deps.configService.updateServer).not.toHaveBeenCalled();
    });
  });

  /* ── Deferred Commands ───────────────────────────────────────────────── */

  describe('Deferred Commands', () => {
    it('jsm.deployment.configureIgnoreGlobs should show deferred message', () => {
      invoke('jsm.deployment.configureIgnoreGlobs');
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('v1.1'),
      );
    });

    describe('jsm.deployment.openLogs', () => {
      it('should do nothing when arg is not a DeploymentNode', async () => {
        await invoke('jsm.deployment.openLogs', undefined);
        expect(mockShowInfoMessage).not.toHaveBeenCalledWith(expect.stringContaining('v1.1'));
        expect(mockShowErrorMessage).not.toHaveBeenCalled();
      });

      it('should show information message when no file log sources are available', async () => {
        deps.pluginRegistry.get.mockReturnValue({
          getLogSources: vi.fn(async () => ok({ others: [] })),
        });
        const node = createDeploymentNode();
        await invoke('jsm.deployment.openLogs', node);
        expect(mockShowInfoMessage).toHaveBeenCalledWith(
          expect.stringContaining('No file log sources'),
        );
      });

      it('should open single log file when one source is returned', async () => {
        mockOpenTextDocument.mockResolvedValue({});
        mockShowTextDocument.mockResolvedValue(undefined);
        deps.pluginRegistry.get.mockReturnValue({
          getLogSources: vi.fn(async () => ok({
            primary: { id: 'catalina-out', title: 'Catalina Log', kind: 'file' as const, path: '/tmp/logs/catalina.out' },
            others: [],
          })),
        });
        const node = createDeploymentNode();
        await invoke('jsm.deployment.openLogs', node);
        expect(mockOpenTextDocument).toHaveBeenCalled();
        expect(mockShowTextDocument).toHaveBeenCalled();
      });

      it('should show error when server config is not found', async () => {
        deps.configService.getServer.mockReturnValue(undefined);
        const node = createDeploymentNode();
        await invoke('jsm.deployment.openLogs', node);
        expect(mockShowErrorMessage).toHaveBeenCalled();
      });
    });
  });
});

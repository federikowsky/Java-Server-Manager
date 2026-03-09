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
const registeredHandlers: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: mockShowErrorMessage,
    showInformationMessage: mockShowInfoMessage,
    showWarningMessage: mockShowWarningMessage,
    createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
  },
  commands: {
    registerCommand: vi.fn((_id: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers[_id] = handler;
      return { dispose: vi.fn() };
    }),
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

function makeDeployment(id = 'dep-1', syncMode: 'off' | 'manual' | 'auto' = 'auto'): DeploymentConfig {
  return {
    id, type: 'exploded', sourcePath: '/src/app', deployName: 'myapp',
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
  return {
    configService: {
      getServer: vi.fn((_id: string) => makeServer(_id)),
      removeDeployment: vi.fn(async () => ok(undefined)),
      updateServer: vi.fn(async () => ok(undefined)),
    },
    deployService: {
      fullRedeploy: vi.fn(async () => ok(undefined)),
      undeploy: vi.fn(async () => ok(undefined)),
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
      'jsm.deployment.add', 'jsm.deployment.sync', 'jsm.deployment.fullRedeploy',
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
    it('jsm.deployment.add should open deployment form in create mode', () => {
      const node = createServerNode();
      invoke('jsm.deployment.add', node);
      expect(deps.deploymentFormPanel.open).toHaveBeenCalledWith('create', 'srv-1');
    });

    it('jsm.deployment.edit should open deployment form in edit mode', () => {
      const node = createDeploymentNode();
      invoke('jsm.deployment.edit', node);
      expect(deps.deploymentFormPanel.open).toHaveBeenCalledWith('edit', 'srv-1', 'dep-1');
    });

    it('jsm.deployment.sync should call deployService.fullRedeploy', async () => {
      const dep = makeDeployment();
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.sync', node);

      expect(deps.deployService.fullRedeploy).toHaveBeenCalled();
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('Sync completed'),
      );
    });

    it('jsm.deployment.fullRedeploy should call deployService.fullRedeploy', async () => {
      const dep = makeDeployment();
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.fullRedeploy', node);

      expect(deps.deployService.fullRedeploy).toHaveBeenCalled();
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('Full Redeploy completed'),
      );
    });

    it('jsm.deployment.undeploy should call deployService.undeploy', async () => {
      const dep = makeDeployment();
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.undeploy', node);

      expect(deps.deployService.undeploy).toHaveBeenCalled();
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
    it('should cycle off → manual', async () => {
      const dep = makeDeployment('dep-1', 'off');
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

    it('should cycle auto → off', async () => {
      const dep = makeDeployment('dep-1', 'auto');
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.toggleAutosync', node);

      expect(deps.configService.updateServer).toHaveBeenCalledWith(
        expect.objectContaining({
          deployments: [expect.objectContaining({ syncMode: 'off' })],
        }),
      );
    });

    it('should show error when updateServer fails', async () => {
      const dep = makeDeployment('dep-1', 'off');
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
      'jsm.deployment.sync', 'jsm.deployment.fullRedeploy', 'jsm.deployment.undeploy',
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
      expect(deps.deploymentFormPanel.open).not.toHaveBeenCalled();
    });
  });

  /* ── Negative Path ───────────────────────────────────────────────────── */

  describe('Negative Path', () => {
    it('sync should silently return when server not found', async () => {
      deps.configService.getServer.mockReturnValue(undefined);
      const node = createDeploymentNode();
      await invoke('jsm.deployment.sync', node);
      expect(deps.deployService.fullRedeploy).not.toHaveBeenCalled();
    });

    it('sync should silently return when deployment not found in server', async () => {
      const server = makeServer();
      server.deployments = []; // No deployments
      deps.configService.getServer.mockReturnValue(server);

      const node = createDeploymentNode();
      await invoke('jsm.deployment.sync', node);
      expect(deps.deployService.fullRedeploy).not.toHaveBeenCalled();
    });

    it('sync should show error when fullRedeploy fails', async () => {
      const dep = makeDeployment();
      const server = makeServer();
      server.deployments = [dep];
      deps.configService.getServer.mockReturnValue(server);
      deps.deployService.fullRedeploy.mockResolvedValue(
        err(new JsmError({ code: ErrorCode.DeployFailed, message: 'Deploy error' })),
      );

      const node = createDeploymentNode('srv-1', dep);
      await invoke('jsm.deployment.sync', node);

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

    it('jsm.deployment.openLogs should show deferred message', () => {
      invoke('jsm.deployment.openLogs');
      expect(mockShowInfoMessage).toHaveBeenCalledWith(
        expect.stringContaining('v1.1'),
      );
    });
  });
});

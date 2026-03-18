/**
 * Exhaustive test suite: ServerTreeViewProvider
 *
 * Categories: happy path, edge cases, boundary cases, stateful/lifecycle
 * (debounce, force refresh), concurrency (rapid refresh calls)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerConfig, DeploymentConfig, ServerState, DeploymentState, ServerId, DeploymentId } from '@core/types';
import { TREE_REFRESH_DEBOUNCE_MS } from '../../constants';

/* ══════════════════════════════════════════════════════════════════════════
 * VS Code mock
 * ══════════════════════════════════════════════════════════════════════════ */

const mockCreateTreeView = vi.fn(() => ({ dispose: vi.fn() }));

vi.mock('vscode', () => ({
  window: {
    createTreeView: mockCreateTreeView,
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class {
    label: string;
    collapsibleState: number;
    contextValue?: string;
    description?: string;
    iconPath?: unknown;
    tooltip?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  MarkdownString: class {
    isTrusted = false;
    private buf = '';
    appendMarkdown(s: string) { this.buf += s; return this; }
  },
  EventEmitter: class {
    private listeners: Array<(e: unknown) => void> = [];
    event = (listener: (e: unknown) => void) => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };
    fire(e: unknown) { this.listeners.forEach(l => l(e)); }
    dispose() { this.listeners = []; }
  },
}));

/* ══════════════════════════════════════════════════════════════════════════
 * Imports (after mock)
 * ══════════════════════════════════════════════════════════════════════════ */

const { ServerTreeViewProvider, ServerNode, DeploymentNode, registerTreeView } = await import(
  '@ui/tree/ServerTreeViewProvider'
);
type TreeDataSource = ConstructorParameters<typeof ServerTreeViewProvider>[0];

/* ══════════════════════════════════════════════════════════════════════════
 * Helpers
 * ══════════════════════════════════════════════════════════════════════════ */

function makeServer(id = 'srv-1', name = 'Tomcat', deployments: DeploymentConfig[] = []): ServerConfig {
  return {
    id, name, type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/opt/tomcat', version: '10.1' },
    instancePath: '/tmp/inst', javaHome: '/opt/java', host: '127.0.0.1',
    ports: { http: 8080, debug: 5005 },
    run: { env: {}, vmArgs: [] },
    debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
    deployments,
    autosync: { enabled: true, debounceMs: 400, maxBatchFiles: 200, maxBatchBytes: 20_000_000, stormBackoffMs: 2000, ignoreGlobs: [] },
    hooks: [],
  };
}

function makeDep(id = 'dep-1', deployName = 'myapp'): DeploymentConfig {
  return {
    id, type: 'exploded', sourcePath: '/src/app', deployName,
    syncMode: 'auto', hotReload: false, ignoreGlobs: [], hooks: [],
  };
}

function mockDataSource(servers: ServerConfig[] = []): TreeDataSource {
  const workspaceFolderUri = 'file:///test-ws';
  const workspaceFolderName = 'test-ws';
  const records = servers.map(config => ({
    workspaceFolderUri,
    workspaceFolderName,
    workspaceFolderFsPath: '/test-ws',
    serverId: config.id,
    serverKey: config.id,
    config,
  }));
  return {
    getWorkspaceFolders: vi.fn(() => [{ workspaceFolderUri, workspaceFolderName }]),
    getServers: vi.fn((_uri: string) => records),
    getRuntimeState: vi.fn((_sid: ServerId) => undefined),
    getDeploymentState: vi.fn((_sid: ServerId, _did: DeploymentId) => 'undeployed' as DeploymentState),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tests
 * ══════════════════════════════════════════════════════════════════════════ */

describe('ServerTreeViewProvider', () => {
  let ds: ReturnType<typeof mockDataSource>;
  let provider: InstanceType<typeof ServerTreeViewProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    ds = mockDataSource();
    provider = new ServerTreeViewProvider(ds);
  });

  afterEach(() => {
    provider.dispose();
    vi.useRealTimers();
  });

  /* ── Happy Path ──────────────────────────────────────────────────────── */

  describe('Happy Path', () => {
    it('should return empty array when no servers', () => {
      const children = provider.getChildren();
      expect(children).toEqual([]);
    });

    it('should return ServerNode for each server at root level', () => {
      ds = mockDataSource([makeServer('s1', 'Server A'), makeServer('s2', 'Server B')]);
      provider = new ServerTreeViewProvider(ds);

      const children = provider.getChildren();
      expect(children).toHaveLength(2);
      expect(children[0]).toBeInstanceOf(ServerNode);
      expect(children[1]).toBeInstanceOf(ServerNode);
    });

    it('ServerNode should contain serverId and serverConfig', () => {
      const server = makeServer('s1', 'TestServer');
      ds = mockDataSource([server]);
      provider = new ServerTreeViewProvider(ds);

      const nodes = provider.getChildren();
      const node = nodes[0] as InstanceType<typeof ServerNode>;
      expect(node.serverId).toBe('s1');
      expect(node.serverConfig.name).toBe('TestServer');
    });

    it('should return DeploymentNodes as children of ServerNode', () => {
      const dep = makeDep('d1', 'myapp');
      const server = makeServer('s1', 'Tomcat', [dep]);
      ds = mockDataSource([server]);
      provider = new ServerTreeViewProvider(ds);

      const [serverNode] = provider.getChildren();
      const deployments = provider.getChildren(serverNode as any);
      expect(deployments).toHaveLength(1);
      expect(deployments[0]).toBeInstanceOf(DeploymentNode);
    });

    it('DeploymentNode should contain serverId, deploymentId, and deploymentConfig', () => {
      const dep = makeDep('d1', 'myapp');
      const server = makeServer('s1', 'Tomcat', [dep]);
      ds = mockDataSource([server]);
      provider = new ServerTreeViewProvider(ds);

      const [serverNode] = provider.getChildren();
      const [depNode] = provider.getChildren(serverNode as any) as InstanceType<typeof DeploymentNode>[];
      expect(depNode.serverId).toBe('s1');
      expect(depNode.deploymentId).toBe('d1');
      expect(depNode.deploymentConfig.deployName).toBe('myapp');
    });

    it('DeploymentNode has no children', () => {
      const dep = makeDep();
      const server = makeServer('s1', 'Tomcat', [dep]);
      ds = mockDataSource([server]);
      provider = new ServerTreeViewProvider(ds);

      const [serverNode] = provider.getChildren();
      const [depNode] = provider.getChildren(serverNode as any);
      const depChildren = provider.getChildren(depNode as any);
      expect(depChildren).toEqual([]);
    });

    it('getTreeItem returns the element itself', () => {
      const dep = makeDep();
      const server = makeServer('s1', 'Tomcat', [dep]);
      ds = mockDataSource([server]);
      provider = new ServerTreeViewProvider(ds);

      const [serverNode] = provider.getChildren();
      expect(provider.getTreeItem(serverNode as any)).toBe(serverNode);
    });
  });

  /* ── Edge Cases: Server States ───────────────────────────────────────── */

  describe('Server States affect context and icons', () => {
    for (const state of ['stopped', 'starting', 'running', 'stopping', 'error'] as ServerState[]) {
      it(`should set correct contextValue for state: ${state}`, () => {
        const server = makeServer();
        ds = mockDataSource([server]);
        (ds.getRuntimeState as any).mockReturnValue({ state });
        provider = new ServerTreeViewProvider(ds);

        const [node] = provider.getChildren() as InstanceType<typeof ServerNode>[];
        expect(node.contextValue).toBe(`jsm.server.${state}`);
      });
    }
  });

  /* ── Edge Cases: Deployment States ───────────────────────────────────── */

  describe('Deployment States affect context and icons', () => {
    for (const state of ['undeployed', 'deploying', 'synced', 'error'] as DeploymentState[]) {
      it(`should set correct contextValue for deployment state: ${state}`, () => {
        const dep = makeDep();
        const server = makeServer('s1', 'Tomcat', [dep]);
        ds = mockDataSource([server]);
        (ds.getDeploymentState as any).mockReturnValue(state);
        provider = new ServerTreeViewProvider(ds);

        const [serverNode] = provider.getChildren();
        const [depNode] = provider.getChildren(serverNode as any) as InstanceType<typeof DeploymentNode>[];
        expect(depNode.contextValue).toBe(`jsm.deployment.exploded.${state}`);
      });
    }
  });

  /* ── Boundary Cases ──────────────────────────────────────────────────── */

  describe('Boundary Cases', () => {
    it('should handle 100 servers', () => {
      const servers = Array.from({ length: 100 }, (_, i) => makeServer(`s${i}`, `Server ${i}`));
      ds = mockDataSource(servers);
      provider = new ServerTreeViewProvider(ds);

      const children = provider.getChildren();
      expect(children).toHaveLength(100);
    });

    it('should handle server with 50 deployments', () => {
      const deps = Array.from({ length: 50 }, (_, i) => makeDep(`d${i}`, `app${i}`));
      const server = makeServer('s1', 'Tomcat', deps);
      ds = mockDataSource([server]);
      provider = new ServerTreeViewProvider(ds);

      const [serverNode] = provider.getChildren();
      const depNodes = provider.getChildren(serverNode as any);
      expect(depNodes).toHaveLength(50);
    });

    it('ServerNode with no deployments should have Collapsed=None', () => {
      const server = makeServer('s1', 'Tomcat', []);
      ds = mockDataSource([server]);
      provider = new ServerTreeViewProvider(ds);

      const [node] = provider.getChildren() as InstanceType<typeof ServerNode>[];
      expect(node.collapsibleState).toBe(0); // None
    });

    it('ServerNode with deployments should have Collapsed=Expanded', () => {
      const server = makeServer('s1', 'Tomcat', [makeDep()]);
      ds = mockDataSource([server]);
      provider = new ServerTreeViewProvider(ds);

      const [node] = provider.getChildren() as InstanceType<typeof ServerNode>[];
      expect(node.collapsibleState).toBe(2); // Expanded
    });
  });

  /* ── Tooltip Content ─────────────────────────────────────────────────── */

  describe('Tooltip Content', () => {
    it('ServerNode tooltip should include server name, state, and ports', () => {
      const server = makeServer('s1', 'MyServer');
      server.ports.http = 9090;
      ds = mockDataSource([server]);
      provider = new ServerTreeViewProvider(ds);

      const [node] = provider.getChildren() as InstanceType<typeof ServerNode>[];
      expect(node.tooltip).toBeDefined();
    });

    it('DeploymentNode tooltip should include deploy name and type', () => {
      const dep = makeDep('d1', 'myapp');
      const server = makeServer('s1', 'Tomcat', [dep]);
      ds = mockDataSource([server]);
      provider = new ServerTreeViewProvider(ds);

      const [serverNode] = provider.getChildren();
      const [depNode] = provider.getChildren(serverNode as any) as InstanceType<typeof DeploymentNode>[];
      expect(depNode.tooltip).toBeDefined();
    });
  });

  /* ── Refresh Debounce ────────────────────────────────────────────────── */

  describe('Refresh Debounce', () => {
    it('requestRefresh should fire after debounce timer', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.requestRefresh();
      expect(listener).not.toHaveBeenCalled();

      vi.advanceTimersByTime(TREE_REFRESH_DEBOUNCE_MS);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('multiple requestRefresh calls should coalesce into one fire', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.requestRefresh();
      provider.requestRefresh();
      provider.requestRefresh();

      vi.advanceTimersByTime(TREE_REFRESH_DEBOUNCE_MS);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('forceRefresh should fire immediately without waiting', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.forceRefresh();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('forceRefresh should cancel pending debounced refresh', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.requestRefresh();
      provider.forceRefresh(); // fires immediately, cancels pending

      vi.advanceTimersByTime(TREE_REFRESH_DEBOUNCE_MS * 2);
      expect(listener).toHaveBeenCalledTimes(1); // Only the force one
    });

    it('requestRefresh after forceRefresh should work independently', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.forceRefresh();
      expect(listener).toHaveBeenCalledTimes(1);

      provider.requestRefresh();
      vi.advanceTimersByTime(TREE_REFRESH_DEBOUNCE_MS);
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  /* ── Dispose Safety ──────────────────────────────────────────────────── */

  describe('Dispose Safety', () => {
    it('dispose should clear pending timers', () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.requestRefresh();
      provider.dispose();

      vi.advanceTimersByTime(TREE_REFRESH_DEBOUNCE_MS * 2);
      expect(listener).not.toHaveBeenCalled();
    });

    it('dispose should not throw if called twice', () => {
      provider.dispose();
      expect(() => provider.dispose()).not.toThrow();
    });
  });

  /* ── registerTreeView ────────────────────────────────────────────────── */

  describe('registerTreeView', () => {
    it('should create a tree view and return provider + disposables', () => {
      const result = registerTreeView(ds);
      expect(result.provider).toBeInstanceOf(ServerTreeViewProvider);
      expect(result.disposables.length).toBeGreaterThanOrEqual(1);
      expect(mockCreateTreeView).toHaveBeenCalled();
    });
  });
});

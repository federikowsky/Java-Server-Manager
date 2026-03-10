import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@core/types/domain';
import { ok } from '@core/result';

const mockShowErrorMessage = vi.fn();
const mockShowInfoMessage = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowQuickPick = vi.fn();
const mockShowTextDocument = vi.fn();
const mockOpenTextDocument = vi.fn(async (uri: { fsPath: string; path: string }) => ({ uri }));
const mockExecuteCommand = vi.fn();
const registeredHandlers: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: mockShowErrorMessage,
    showInformationMessage: mockShowInfoMessage,
    showWarningMessage: mockShowWarningMessage,
    showQuickPick: mockShowQuickPick,
    showTextDocument: mockShowTextDocument,
    createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    openTextDocument: mockOpenTextDocument,
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

const { registerServerCommands } = await import('@ui/commands/server-commands');
const { ServerNode } = await import('@ui/tree/ServerTreeViewProvider');

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

function createServerNode(server = makeServer()): InstanceType<typeof ServerNode> {
  return new ServerNode(server, 'stopped');
}

function mockDeps() {
  return {
    lifecycle: {
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      cancel: vi.fn(),
    },
    pluginRegistry: {
      get: vi.fn(() => ({
        getConfigSources: vi.fn(async () => ok([])),
      })),
    },
    configService: {
      getServer: vi.fn((_id: string) => makeServer(_id)),
      reload: vi.fn(),
    },
    provisioningService: {
      removeServer: vi.fn(),
    },
    deployService: {
      redeployAll: vi.fn(),
    },
    diagnosticsService: {
      generateBundleText: vi.fn(() => 'diag'),
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
});
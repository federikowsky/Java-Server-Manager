import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@core/types/logger';

const mockConfigUpdate = vi.fn(async () => undefined);
const mockConfigGet = vi.fn((_key: string, fallback?: unknown) => fallback);

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      update: mockConfigUpdate,
      get: mockConfigGet,
    })),
  },
  window: {
    showWarningMessage: vi.fn(),
    showOpenDialog: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn(),
    createWebviewPanel: vi.fn(),
  },
  ConfigurationTarget: {
    Global: 1,
  },
  ProgressLocation: {
    Notification: 15,
  },
  ViewColumn: {
    One: 1,
  },
  Uri: {
    joinPath: vi.fn(),
  },
}));

const { DashboardPanel } = await import('@ui/webviews/panels/DashboardPanel');

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeDeps(trusted: boolean) {
  return {
    extensionUri: { fsPath: '/ext', path: '/ext' },
    workspaceRegistry: {
      getAllServers: vi.fn(() => []),
      getWorkspaceScopes: vi.fn(() => []),
      removeServer: vi.fn(),
    },
    lifecycle: {
      getRuntime: vi.fn(() => undefined),
    },
    templateService: {
      listScoped: vi.fn(() => []),
    },
    pluginRegistry: {
      getSupportedTypes: vi.fn(() => []),
      get: vi.fn(() => undefined),
    },
    discoveryService: {},
    deployService: {
      getDeploymentState: vi.fn(() => 'undeployed'),
    },
    logger: mockLogger(),
    bus: {
      on: vi.fn(() => ({ dispose: vi.fn() })),
    },
    trustGate: {
      isTrusted: vi.fn(() => trusted),
    },
  };
}

describe('DashboardPanel trust enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks settings writes when the workspace is untrusted', async () => {
    const panel = new DashboardPanel(makeDeps(false) as any);

    const result = await (panel as any).handleSettingsSave({
      defaultHttpPort: 8180,
      defaultDebugPort: 5100,
      defaultJavaHome: '/jdk',
    });

    expect(result).toEqual({
      ok: false,
      message: 'Grant workspace trust to modify JSM settings.',
    });
    expect(mockConfigUpdate).not.toHaveBeenCalled();
  });

  it('allows settings writes when the workspace is trusted', async () => {
    const panel = new DashboardPanel(makeDeps(true) as any);

    const result = await (panel as any).handleSettingsSave({
      defaultHttpPort: 8180,
      defaultDebugPort: 5100,
      defaultJavaHome: '/jdk',
    });

    expect(result).toEqual({ ok: true });
    expect(mockConfigUpdate).toHaveBeenCalledTimes(4);
  });
});

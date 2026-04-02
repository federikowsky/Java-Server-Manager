import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  configGet: vi.fn((_key: string, fallback?: unknown) => fallback),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mocked.configGet,
    })),
    isTrusted: true,
  },
}));

const { buildDashboardSyncStatePayload } = await import('@ui/webviews/panels/dashboard/buildDashboardSyncStatePayload');

function makeDeps() {
  return {
    workspaceRegistry: {
      getAllServers: vi.fn(() => []),
      getWorkspaceScopes: vi.fn(() => []),
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
    deployService: undefined,
    trustGate: {
      isTrusted: vi.fn(() => true),
    },
  };
}

describe('buildDashboardSyncStatePayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads stored showStatusInSidebar=false correctly', () => {
    mocked.configGet.mockImplementation((key: string, fallback?: unknown) => (
      key === 'ui.showStatusInSidebar' ? false : fallback
    ));

    const payload = buildDashboardSyncStatePayload(makeDeps() as never);

    expect(payload.settings.showStatusInSidebar).toBe(false);
  });

  it('defaults showStatusInSidebar to true when the setting is absent', () => {
    mocked.configGet.mockImplementation((_key: string, fallback?: unknown) => fallback);

    const payload = buildDashboardSyncStatePayload(makeDeps() as never);

    expect(payload.settings.showStatusInSidebar).toBe(true);
  });
});

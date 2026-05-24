import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

const showWarningMessage = vi.fn();

vi.mock('vscode', () => ({
  window: {
    showWarningMessage: (...args: unknown[]) => showWarningMessage(...args),
  },
}));

const { deleteServerWithConfirm } = await import('@ui/webviews/panels/dashboard/dashboardPanelTemplateCrud');

function makeDeps(options: {
  removeResult?: ReturnType<typeof ok<void>> | ReturnType<typeof err>;
  entryMissing?: boolean;
} = {}) {
  const provisioningRemoveServer = vi.fn(async () => options.removeResult ?? ok(undefined));
  const inventoryRemoveServer = vi.fn(async () => ok(undefined));
  return {
    deps: {
      workspaceRegistry: {
        getEntry: vi.fn(() => options.entryMissing ? undefined : {
          provisioningService: {
            removeServer: provisioningRemoveServer,
          },
        }),
        removeServer: inventoryRemoveServer,
      },
      logger: {
        error: vi.fn(),
      },
    },
    provisioningRemoveServer,
    inventoryRemoveServer,
  };
}

describe('dashboard server deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancels without side effects when the user does not confirm', async () => {
    const { deps, provisioningRemoveServer, inventoryRemoveServer } = makeDeps();
    const postError = vi.fn();
    const syncState = vi.fn();
    showWarningMessage.mockResolvedValue(undefined);

    await deleteServerWithConfirm(deps as any, postError, syncState, 'srv-1', 'file:///ws');

    expect(provisioningRemoveServer).not.toHaveBeenCalled();
    expect(inventoryRemoveServer).not.toHaveBeenCalled();
    expect(syncState).not.toHaveBeenCalled();
    expect(postError).not.toHaveBeenCalled();
  });

  it('uses provisioning cleanup instead of inventory-only removal', async () => {
    const { deps, provisioningRemoveServer, inventoryRemoveServer } = makeDeps();
    const postError = vi.fn();
    const syncState = vi.fn();
    showWarningMessage.mockResolvedValue('Delete');

    await deleteServerWithConfirm(deps as any, postError, syncState, 'srv-1', 'file:///ws');

    expect(deps.workspaceRegistry.getEntry).toHaveBeenCalledWith('file:///ws');
    expect(provisioningRemoveServer).toHaveBeenCalledWith('srv-1');
    expect(inventoryRemoveServer).not.toHaveBeenCalled();
    expect(syncState).toHaveBeenCalledOnce();
    expect(postError).not.toHaveBeenCalled();
  });

  it('reports provisioning cleanup failures without refreshing dashboard state', async () => {
    const { deps } = makeDeps({
      removeResult: err(new JsmError({
        code: ErrorCode.InvalidConfig,
        message: 'cleanup failed',
      })),
    });
    const postError = vi.fn();
    const syncState = vi.fn();
    showWarningMessage.mockResolvedValue('Delete');

    await deleteServerWithConfirm(deps as any, postError, syncState, 'srv-1', 'file:///ws');

    expect(postError).toHaveBeenCalledWith('cleanup failed');
    expect(syncState).not.toHaveBeenCalled();
  });

  it('fails closed when the workspace entry is missing', async () => {
    const { deps, provisioningRemoveServer, inventoryRemoveServer } = makeDeps({ entryMissing: true });
    const postError = vi.fn();
    const syncState = vi.fn();
    showWarningMessage.mockResolvedValue('Delete');

    await deleteServerWithConfirm(deps as any, postError, syncState, 'srv-1', 'file:///missing');

    expect(provisioningRemoveServer).not.toHaveBeenCalled();
    expect(inventoryRemoveServer).not.toHaveBeenCalled();
    expect(postError).toHaveBeenCalledWith(expect.stringContaining('not registered'));
    expect(syncState).not.toHaveBeenCalled();
  });
});

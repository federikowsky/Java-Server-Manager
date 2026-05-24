import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { Logger } from '@core/types/logger';
import { OperationHistoryService } from '@app/operations';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('OperationHistoryService', () => {
  it('records running and completed operations with duration', () => {
    let now = 1000;
    const bus = new EventBus(mockLogger());
    const service = new OperationHistoryService({ bus, now: () => now });

    bus.emit('OperationStarted', {
      serverId: 'ws::srv-1',
      operationId: 'op-1',
      kind: 'LifecycleStart',
    });
    now = 1750;
    bus.emit('OperationCompleted', {
      serverId: 'ws::srv-1',
      operationId: 'op-1',
      kind: 'LifecycleStart',
    });

    expect(service.getRecent('ws::srv-1')).toEqual([
      expect.objectContaining({
        operationId: 'op-1',
        kind: 'LifecycleStart',
        status: 'succeeded',
        startedAt: 1000,
        finishedAt: 1750,
        durationMs: 750,
      }),
    ]);
  });

  it('records failed operations with error details', () => {
    const bus = new EventBus(mockLogger());
    const service = new OperationHistoryService({ bus, now: () => 10 });
    const error = new JsmError({
      code: ErrorCode.Timeout,
      message: 'readiness timed out',
      suggestedFix: ['Check the configured HTTP port'],
    });

    bus.emit('OperationStarted', {
      serverId: 'ws::srv-1',
      operationId: 'op-1',
      kind: 'DeployFull',
      targetDeploymentId: 'dep-1',
    });
    bus.emit('OperationFailed', {
      serverId: 'ws::srv-1',
      operationId: 'op-1',
      kind: 'DeployFull',
      targetDeploymentId: 'dep-1',
      error,
    });

    expect(service.getRecent('ws::srv-1')).toEqual([
      expect.objectContaining({
        status: 'failed',
        targetDeploymentId: 'dep-1',
        errorCode: ErrorCode.Timeout,
        errorMessage: 'readiness timed out',
        suggestedFix: ['Check the configured HTTP port'],
      }),
    ]);
  });

  it('keeps only the configured number of recent entries and purges deleted servers', () => {
    let now = 1;
    const bus = new EventBus(mockLogger());
    const service = new OperationHistoryService({ bus, limit: 2, now: () => now++ });

    for (const operationId of ['op-1', 'op-2', 'op-3']) {
      bus.emit('OperationStarted', {
        serverId: 'file:///ws::srv-1',
        operationId,
        kind: 'StatusRefresh',
      });
    }

    expect(service.getRecent('file:///ws::srv-1').map(entry => entry.operationId)).toEqual(['op-3', 'op-2']);

    bus.emit('ServerDeleted', {
      serverId: 'srv-1',
      workspaceFolderUri: 'file:///ws',
    });

    expect(service.getRecent('file:///ws::srv-1')).toEqual([]);
  });
});

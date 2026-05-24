import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@core/events/EventBus';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { LocalTelemetryService } from '@app/telemetry';
import type { KeyValueStore, Logger } from '@core/types';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as unknown as Logger;
}

function memoryStore(): KeyValueStore {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: vi.fn(async <T>(key: string, value: T) => {
      values.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

describe('LocalTelemetryService', () => {
  it('does not record anything while disabled', async () => {
    const store = memoryStore();
    const service = new LocalTelemetryService({
      bus: new EventBus(mockLogger()),
      store,
      logger: mockLogger(),
      isEnabled: () => false,
    });

    expect(service.getSnapshot()).toBeUndefined();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('records only aggregate local counters when enabled', async () => {
    const store = memoryStore();
    const bus = new EventBus(mockLogger());
    const service = new LocalTelemetryService({
      bus,
      store,
      logger: mockLogger(),
      isEnabled: () => true,
      now: () => new Date('2026-05-24T12:00:00.000Z'),
    });

    bus.emit('OperationCompleted', {
      serverId: 'file:///secret-workspace::server-1',
      operationId: 'op-1',
      kind: 'LifecycleStart',
    });
    bus.emit('OperationFailed', {
      serverId: 'file:///secret-workspace::server-1',
      operationId: 'op-2',
      kind: 'DeployFull',
      error: new JsmError({ code: ErrorCode.OperationFailed, message: 'boom' }),
    });
    bus.emit('ServerAdded', { serverId: 'server-1', workspaceFolderUri: 'file:///secret-workspace' });
    await new Promise(resolve => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot();

    expect(snapshot?.counters.operations).toEqual({ succeeded: 1, failed: 1 });
    expect(snapshot?.counters.operationsByKind).toEqual({
      LifecycleStart: { succeeded: 1, failed: 0 },
      DeployFull: { succeeded: 0, failed: 1 },
    });
    expect(snapshot?.counters.inventory.serversAdded).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain('secret-workspace');
    expect(JSON.stringify(snapshot)).not.toContain('server-1');
  });

  it('clears stored local counters', async () => {
    const store = memoryStore();
    const service = new LocalTelemetryService({
      bus: new EventBus(mockLogger()),
      store,
      logger: mockLogger(),
      isEnabled: () => true,
    });

    await store.set('jsm.telemetry.localMetrics.v1', service.getSnapshot());
    await service.clear();

    expect(store.delete).toHaveBeenCalledWith('jsm.telemetry.localMetrics.v1');
  });
});

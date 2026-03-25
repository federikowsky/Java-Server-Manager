/**
 * APP-SYNC-006: Same pattern as extension.ts autosync wiring — on sync failure, recordFailure
 * so cooldown / failure window can activate (see AutoSyncService.flushPending contract).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSyncService, type FileWatcherFactory } from '@app/sync/AutoSyncService';
import { EventBus } from '@core/events/EventBus';
import type { Logger } from '@core/types/logger';
import type { ServerConfig } from '@core/types/domain';
import type { FileChange } from '@core/types/events';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(): ServerConfig {
  return {
    id: 's1',
    name: 'Test',
    type: 'tomcat',
    runtime: { id: 'rt1', homePath: '/opt/tomcat' },
    instancePath: '/tmp/inst',
    javaHome: '/opt/java',
    host: '127.0.0.1',
    ports: { http: 8080, debug: 5005 },
    run: { env: {}, vmArgs: [] },
    debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
    deployments: [
      {
        id: 'd1',
        type: 'exploded',
        sourcePath: '/src/app',
        deployName: 'app',
        syncMode: 'auto',
        hotReload: false,
        ignoreGlobs: [],
        hooks: [],
      },
    ],
    autosync: {
      enabled: true,
      debounceMs: 400,
      maxBatchFiles: 200,
      maxBatchBytes: 20_000_000,
      stormBackoffMs: 2000,
      ignoreGlobs: [],
    },
    hooks: [],
  };
}

describe('AutoSync sync error → recordFailure pattern (extended)', () => {
  let bus: EventBus;
  let watcherFactory: FileWatcherFactory;
  let capturedOnChange: ((change: FileChange) => void) | undefined;
  const autoSyncRef: { current?: AutoSyncService } = {};

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus(mockLogger());
    capturedOnChange = undefined;
    watcherFactory = {
      watch: vi.fn((_spec: unknown, onChange: (c: FileChange) => void) => {
        capturedOnChange = onChange;
        return { dispose: vi.fn() };
      }),
    };
  });

  afterEach(() => {
    autoSyncRef.current?.dispose();
    vi.useRealTimers();
  });

  it('APP-SYNC-006: holder pattern calls recordFailure when sync returns err (mirrors extension)', async () => {
    const syncMock = vi.fn().mockResolvedValue({
      ok: false,
      error: new JsmError({ code: ErrorCode.Unknown, message: 'sync failed' }),
    });

    const service = new AutoSyncService({
      bus,
      watcherFactory,
      logger: mockLogger(),
      onSyncRequest: async (serverId, deploymentId) => {
        const result = await syncMock(serverId, deploymentId);
        if (!result.ok) {
          autoSyncRef.current?.recordFailure(serverId, deploymentId);
        }
      },
    });
    autoSyncRef.current = service;

    service.enable(makeConfig());

    capturedOnChange!({ path: '/src/app/x.java', type: 'change', relativePath: 'x.java', sizeBytes: 10 });
    await vi.advanceTimersByTimeAsync(500);
    await vi.runOnlyPendingTimersAsync();
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(service.isInCooldown('s1', 'd1')).toBe(false);

    capturedOnChange!({ path: '/src/app/y.java', type: 'change', relativePath: 'y.java', sizeBytes: 10 });
    await vi.advanceTimersByTimeAsync(500);
    await vi.runOnlyPendingTimersAsync();
    expect(syncMock).toHaveBeenCalledTimes(2);
    expect(service.isInCooldown('s1', 'd1')).toBe(true);
  });

  it('APP-SYNC-006b: sync throws → recordFailure in catch (mirrors extension)', async () => {
    const syncMock = vi.fn().mockRejectedValue(new Error('boom'));

    const service = new AutoSyncService({
      bus,
      watcherFactory,
      logger: mockLogger(),
      onSyncRequest: async (serverId, deploymentId) => {
        try {
          await syncMock(serverId, deploymentId);
        } catch {
          autoSyncRef.current?.recordFailure(serverId, deploymentId);
        }
      },
    });
    autoSyncRef.current = service;

    service.enable(makeConfig());

    for (let i = 0; i < 2; i++) {
      capturedOnChange!({ path: `/src/app/e${i}.java`, type: 'change', relativePath: `e${i}.java`, sizeBytes: 10 });
      await vi.advanceTimersByTimeAsync(500);
      await vi.runOnlyPendingTimersAsync();
    }

    expect(service.isInCooldown('s1', 'd1')).toBe(true);
  });
});

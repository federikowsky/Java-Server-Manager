import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSyncService, type FileWatcherFactory } from '@app/sync/AutoSyncService';
import { EventBus } from '@core/events/EventBus';
import type { Logger } from '@core/types/logger';
import type { ServerConfig } from '@core/types/domain';
import type { FileChange } from '@core/types/events';
import { AUTOSYNC_COOLDOWN_MS } from '../../constants';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
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
      ignoreGlobs: ['**/node_modules/**'],
    },
    hooks: [],
    ...overrides,
  };
}

describe('AutoSyncService', () => {
  let bus: EventBus;
  let watcherFactory: FileWatcherFactory;
  let onSyncRequest: ReturnType<typeof vi.fn>;
  let service: AutoSyncService;
  let registrations: Array<{
    spec: unknown;
    onChange: (change: FileChange) => void;
    dispose: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus(mockLogger());
    registrations = [];

    watcherFactory = {
      watch: vi.fn((spec: unknown, onChange: (change: FileChange) => void) => {
        const dispose = vi.fn();
        registrations.push({ spec, onChange, dispose });
        return { dispose };
      }),
    };

    onSyncRequest = vi.fn().mockResolvedValue(undefined);

    service = new AutoSyncService({
      bus,
      watcherFactory,
      logger: mockLogger(),
      onSyncRequest,
    });
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  it('creates a watcher when enabled', () => {
    service.enable(makeConfig());
    expect(watcherFactory.watch).toHaveBeenCalledOnce();
    expect(registrations[0]?.onChange).toBeDefined();
  });

  it('does not create watcher when autosync is disabled', () => {
    service.enable(makeConfig({ autosync: { ...makeConfig().autosync, enabled: false } }));
    expect(watcherFactory.watch).not.toHaveBeenCalled();
  });

  it('does not create watcher for syncMode=manual', () => {
    const config = makeConfig();
    config.deployments[0].syncMode = 'manual';
    service.enable(config);
    expect(watcherFactory.watch).not.toHaveBeenCalled();
  });

  it('creates a file watcher for war deployments when syncMode is auto', () => {
    const config = makeConfig();
    config.deployments[0].type = 'war';
    config.deployments[0].sourcePath = '/build/app.war';
    service.enable(config);
    expect(watcherFactory.watch).toHaveBeenCalledOnce();
    expect(watcherFactory.watch).toHaveBeenCalledWith(
      { kind: 'file', path: '/build/app.war' },
      expect.any(Function),
    );
  });

  it('does not create watcher for war when syncMode is manual', () => {
    const config = makeConfig();
    config.deployments[0].type = 'war';
    config.deployments[0].sourcePath = '/build/app.war';
    config.deployments[0].syncMode = 'manual';
    service.enable(config);
    expect(watcherFactory.watch).not.toHaveBeenCalled();
  });

  it('debounces file changes and fires sync request', () => {
    service.enable(makeConfig());

    registrations[0].onChange({
      type: 'change',
      path: '/src/app/Main.java',
      relativePath: 'Main.java',
      sizeBytes: 100,
    });
    expect(onSyncRequest).not.toHaveBeenCalled();

    vi.advanceTimersByTime(450);

    expect(onSyncRequest).toHaveBeenCalledOnce();
    expect(onSyncRequest).toHaveBeenCalledWith('s1', 'd1', expect.objectContaining({
      totalFiles: 1,
    }));
  });

  it('suspends and resumes file watching', () => {
    service.enable(makeConfig());
    service.suspend('s1');

    registrations[0].onChange({
      type: 'change',
      path: '/src/app/Main.java',
      relativePath: 'Main.java',
    });
    vi.advanceTimersByTime(500);
    expect(onSyncRequest).not.toHaveBeenCalled();

    service.resume('s1');
    registrations[0].onChange({
      type: 'change',
      path: '/src/app/Main.java',
      relativePath: 'Main.java',
    });
    vi.advanceTimersByTime(500);
    expect(onSyncRequest).toHaveBeenCalledOnce();
  });

  it('respects failure cooldown', () => {
    service.enable(makeConfig());
    expect(service.isInCooldown('s1', 'd1')).toBe(false);

    service.recordFailure('s1', 'd1');
    service.recordFailure('s1', 'd1');
    expect(service.isInCooldown('s1', 'd1')).toBe(true);

    registrations[0].onChange({
      type: 'change',
      path: '/src/app/Main.java',
      relativePath: 'Main.java',
    });
    vi.advanceTimersByTime(500);
    expect(onSyncRequest).not.toHaveBeenCalled();
  });

  it('flushes accumulated cooldown changes once the cooldown expires', async () => {
    service.enable(makeConfig());
    service.recordFailure('s1', 'd1');
    service.recordFailure('s1', 'd1');

    registrations[0].onChange({
      type: 'change',
      path: '/src/app/One.java',
      relativePath: 'One.java',
      sizeBytes: 10,
    });
    registrations[0].onChange({
      type: 'change',
      path: '/src/app/Two.java',
      relativePath: 'Two.java',
      sizeBytes: 20,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(onSyncRequest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTOSYNC_COOLDOWN_MS);
    expect(onSyncRequest).toHaveBeenCalledTimes(1);
    expect(onSyncRequest).toHaveBeenCalledWith('s1', 'd1', expect.objectContaining({
      totalFiles: 2,
      totalBytes: 30,
    }));
  });

  it('disable removes watchers', () => {
    const config = makeConfig();
    service.enable(config);
    expect(watcherFactory.watch).toHaveBeenCalledOnce();

    service.disable('s1');
    service.enable(config);
    expect(watcherFactory.watch).toHaveBeenCalledTimes(2);
  });

  it('rebindWatchers keeps the existing watcher when the effective watch spec is unchanged', () => {
    const config = makeConfig();
    service.enable(config);
    expect(watcherFactory.watch).toHaveBeenCalledOnce();

    service.rebindWatchers('s1', config);
    expect(watcherFactory.watch).toHaveBeenCalledTimes(1);
    expect(registrations[0].dispose).not.toHaveBeenCalled();
  });

  it('rebindWatchers clears suspend so sync works after stop-style suspend+disable', () => {
    const config = makeConfig();
    service.enable(config);
    service.suspend('s1');
    service.disable('s1');

    service.rebindWatchers('s1', config);
    expect(watcherFactory.watch).toHaveBeenCalledTimes(2);

    registrations[1].onChange({
      type: 'change',
      path: '/src/app/Main.java',
      relativePath: 'Main.java',
      sizeBytes: 10,
    });
    vi.advanceTimersByTime(500);
    expect(onSyncRequest).toHaveBeenCalledOnce();
  });

  it('purgeServerWatchState removes watchers and clears suspend for a later enable', () => {
    const config = makeConfig();
    service.enable(config);
    service.suspend('s1');
    service.purgeServerWatchState('s1');

    service.enable(config);
    registrations[1].onChange({
      type: 'change',
      path: '/src/app/Main.java',
      relativePath: 'Main.java',
      sizeBytes: 10,
    });
    vi.advanceTimersByTime(500);
    expect(onSyncRequest).toHaveBeenCalledOnce();
  });

  it('uses the per-server debounce value from config', () => {
    const fast = makeConfig({ id: 's1', autosync: { ...makeConfig().autosync, debounceMs: 100 } });
    const slow = makeConfig({ id: 's2', autosync: { ...makeConfig().autosync, debounceMs: 1000 } });

    service.enable(fast, 's1');
    service.enable(slow, 's2');

    registrations[0].onChange({
      type: 'change',
      path: '/src/app/Fast.java',
      relativePath: 'Fast.java',
      sizeBytes: 1,
    });
    registrations[1].onChange({
      type: 'change',
      path: '/src/app/Slow.java',
      relativePath: 'Slow.java',
      sizeBytes: 1,
    });

    vi.advanceTimersByTime(150);
    expect(onSyncRequest).toHaveBeenCalledTimes(1);
    expect(onSyncRequest).toHaveBeenLastCalledWith('s1', 'd1', expect.anything());

    vi.advanceTimersByTime(900);
    expect(onSyncRequest).toHaveBeenCalledTimes(2);
    expect(onSyncRequest).toHaveBeenLastCalledWith('s2', 'd1', expect.anything());
  });

  it('uses the per-server maxBatchFiles threshold', () => {
    service.enable(makeConfig({
      autosync: { ...makeConfig().autosync, maxBatchFiles: 1 },
    }));

    registrations[0].onChange({
      type: 'change',
      path: '/src/app/One.java',
      relativePath: 'One.java',
      sizeBytes: 10,
    });
    registrations[0].onChange({
      type: 'change',
      path: '/src/app/Two.java',
      relativePath: 'Two.java',
      sizeBytes: 10,
    });

    vi.runOnlyPendingTimers();
    expect(onSyncRequest).toHaveBeenCalledOnce();
    expect(onSyncRequest).toHaveBeenCalledWith('s1', 'd1', expect.objectContaining({
      totalFiles: 2,
    }));
  });

  it('uses the per-server maxBatchBytes threshold', () => {
    service.enable(makeConfig({
      autosync: { ...makeConfig().autosync, maxBatchBytes: 15 },
    }));

    registrations[0].onChange({
      type: 'change',
      path: '/src/app/One.java',
      relativePath: 'One.java',
      sizeBytes: 10,
    });
    registrations[0].onChange({
      type: 'change',
      path: '/src/app/Two.java',
      relativePath: 'Two.java',
      sizeBytes: 10,
    });

    vi.runOnlyPendingTimers();
    expect(onSyncRequest).toHaveBeenCalledOnce();
    expect(onSyncRequest).toHaveBeenCalledWith('s1', 'd1', expect.objectContaining({
      totalBytes: 20,
    }));
  });

  it('rebuilds watchers when the effective watch spec changes', () => {
    const config = makeConfig();
    service.enable(config);

    const updated = makeConfig({
      deployments: [{
        ...config.deployments[0],
        sourcePath: '/src/renamed-app',
      }],
    });

    service.rebindWatchers('s1', updated);

    expect(watcherFactory.watch).toHaveBeenCalledTimes(2);
    expect(registrations[0].dispose).toHaveBeenCalledOnce();
  });

  it('suppresses repeated WAR sync dispatches inside stormBackoffMs', () => {
    const config = makeConfig({
      deployments: [{
        ...makeConfig().deployments[0],
        type: 'war',
        sourcePath: '/build/app.war',
      }],
      autosync: { ...makeConfig().autosync, stormBackoffMs: 2000 },
    });

    service.enable(config);

    registrations[0].onChange({
      type: 'change',
      path: '/build/app.war',
      relativePath: 'app.war',
      sizeBytes: 10,
    });
    vi.advanceTimersByTime(450);
    expect(onSyncRequest).toHaveBeenCalledTimes(1);

    registrations[0].onChange({
      type: 'change',
      path: '/build/app.war',
      relativePath: 'app.war',
      sizeBytes: 10,
    });
    vi.advanceTimersByTime(450);
    expect(onSyncRequest).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1600);
    expect(onSyncRequest).toHaveBeenCalledTimes(2);
  });

  it('keeps exploded deployments on normal debounce behavior after a recent dispatch', () => {
    service.enable(makeConfig({
      autosync: { ...makeConfig().autosync, stormBackoffMs: 2000 },
    }));

    registrations[0].onChange({
      type: 'change',
      path: '/src/app/One.java',
      relativePath: 'One.java',
      sizeBytes: 10,
    });
    vi.advanceTimersByTime(450);
    expect(onSyncRequest).toHaveBeenCalledTimes(1);

    registrations[0].onChange({
      type: 'change',
      path: '/src/app/Two.java',
      relativePath: 'Two.java',
      sizeBytes: 10,
    });
    vi.advanceTimersByTime(450);
    expect(onSyncRequest).toHaveBeenCalledTimes(2);
  });
});

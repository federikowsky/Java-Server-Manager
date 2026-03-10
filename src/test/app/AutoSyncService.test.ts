import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSyncService, type FileWatcherFactory } from '@app/sync/AutoSyncService';
import { EventBus } from '@core/events/EventBus';
import type { Logger } from '@core/types/logger';
import type { ServerConfig, DeploymentConfig } from '@core/types/domain';
import type { FileChange } from '@core/types/events';

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
  let capturedOnChange: ((change: FileChange) => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus(mockLogger());
    capturedOnChange = undefined;

    watcherFactory = {
      watch: vi.fn((_sourcePath: string, _ignoreGlobs: string[], onChange: (change: FileChange) => void) => {
        capturedOnChange = onChange;
        return { dispose: vi.fn() };
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
    expect(capturedOnChange).toBeDefined();
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

  it('does not create watcher for war deployments', () => {
    const config = makeConfig();
    config.deployments[0].type = 'war';
    service.enable(config);
    expect(watcherFactory.watch).not.toHaveBeenCalled();
  });

  it('debounces file changes and fires sync request', async () => {
    service.enable(makeConfig());

    const change: FileChange = {
      type: 'change',
      path: '/src/app/Main.java',
      relativePath: 'Main.java',
      sizeBytes: 100,
    };

    capturedOnChange!(change);
    expect(onSyncRequest).not.toHaveBeenCalled();

    // Advance past debounce (400ms)
    vi.advanceTimersByTime(450);

    expect(onSyncRequest).toHaveBeenCalledOnce();
    expect(onSyncRequest).toHaveBeenCalledWith('s1', 'd1', expect.objectContaining({
      totalFiles: 1,
    }));
  });

  it('suspends and resumes file watching', () => {
    service.enable(makeConfig());
    service.suspend('s1');

    const change: FileChange = {
      type: 'change',
      path: '/src/app/Main.java',
      relativePath: 'Main.java',
    };

    capturedOnChange!(change);
    vi.advanceTimersByTime(500);
    expect(onSyncRequest).not.toHaveBeenCalled();

    service.resume('s1');
    capturedOnChange!(change);
    vi.advanceTimersByTime(500);
    expect(onSyncRequest).toHaveBeenCalledOnce();
  });

  it('respects failure cooldown', () => {
    service.enable(makeConfig());
    expect(service.isInCooldown('s1', 'd1')).toBe(false);

    // Record 2 failures within the window
    service.recordFailure('s1', 'd1');
    service.recordFailure('s1', 'd1');
    expect(service.isInCooldown('s1', 'd1')).toBe(true);

    // Changes during cooldown are ignored
    capturedOnChange!({
      type: 'change',
      path: '/src/app/Main.java',
      relativePath: 'Main.java',
    });
    vi.advanceTimersByTime(500);
    expect(onSyncRequest).not.toHaveBeenCalled();
  });

  it('disable removes watchers', () => {
    const config = makeConfig();
    service.enable(config);
    expect(watcherFactory.watch).toHaveBeenCalledOnce();

    service.disable('s1');
    // Re-enabling should create a new watcher
    service.enable(config);
    expect(watcherFactory.watch).toHaveBeenCalledTimes(2);
  });
});

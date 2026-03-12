import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConfigService } from '@app/config/ConfigService';
import { WorkspaceServiceRegistry } from '@app/config/WorkspaceServiceRegistry';
import { ConfigRepo } from '@infra/fs/ConfigRepo';
import { SchemaValidator } from '@core/validation/SchemaValidator';
import { EventBus } from '@core/events/EventBus';
import type { Logger } from '@core/types/logger';
import type { ServerConfig, DeploymentConfig } from '@core/types/domain';
import type { EventKey, EventMap } from '@core/types/events';

/* ── helpers ─────────────────────────────────────────────────────────────── */

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

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

function makeDeployment(id = 'dep-1'): DeploymentConfig {
  return {
    id,
    type: 'exploded',
    sourcePath: '/src/app',
    deployName: 'app',
    syncMode: 'auto',
    ignoreGlobs: [],
    hooks: [],
  };
}

/* ── integration tests ───────────────────────────────────────────────────── */

describe('Config → Repo → EventBus integration', () => {
  let tmpDir: string;
  let repo: ConfigRepo;
  let bus: EventBus;
  let validator: SchemaValidator;
  let service: ConfigService;
  const events: Array<{ event: EventKey; payload: unknown }> = [];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-integ-'));
    // Create .vscode dir as ConfigRepo expects it
    await fs.mkdir(path.join(tmpDir, '.vscode'), { recursive: true });

    const logger = mockLogger();
    repo = new ConfigRepo(tmpDir, logger);
    bus = new EventBus(logger);
    validator = new SchemaValidator();
    // SchemaValidator passes all checks when no schema registered for 'server-config'
    // Register a permissive schema so validate() always passes
    validator.addSchema('server-config', { type: 'object' });

    service = new ConfigService({ repo, validator, bus, logger });

    events.length = 0;
    const trackEvents: EventKey[] = [
      'ServerAdded', 'ServerUpdated', 'ServerDeleted',
      'DeploymentAdded', 'DeploymentRemoved', 'ConfigChanged',
    ];
    for (const key of trackEvents) {
      bus.on(key, (payload: EventMap[typeof key]) => {
        events.push({ event: key, payload });
      });
    }
  });

  afterEach(async () => {
    bus.dispose();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('add server → persists to disk → reload reads it back', async () => {
    const srv = makeServer();

    // Add
    const addResult = await service.addServer(srv);
    expect(addResult.ok).toBe(true);
    expect(events.some(e => e.event === 'ServerAdded')).toBe(true);

    // Verify file persisted
    const fileContent = await fs.readFile(
      path.join(tmpDir, '.vscode', 'jsm.servers.json'),
      'utf-8',
    );
    const parsed = JSON.parse(fileContent);
    expect(parsed.servers).toHaveLength(1);
    expect(parsed.servers[0].id).toBe('srv-1');

    // Reload from disk
    events.length = 0;
    const reloadResult = await service.reload();
    expect(reloadResult.ok).toBe(true);
    expect(events.some(e => e.event === 'ConfigChanged')).toBe(true);
    expect(service.getAllServers()).toHaveLength(1);
  });

  it('full CRUD cycle: add → update → remove', async () => {
    // Add
    await service.addServer(makeServer());
    expect(service.getAllServers()).toHaveLength(1);

    // Update
    const updated = makeServer('srv-1', 'Renamed');
    const upResult = await service.updateServer(updated);
    expect(upResult.ok).toBe(true);
    expect(service.getServer('srv-1')?.name).toBe('Renamed');

    // Remove
    const rmResult = await service.removeServer('srv-1');
    expect(rmResult.ok).toBe(true);
    expect(service.getAllServers()).toHaveLength(0);

    // Verify event order
    const eventNames = events.map(e => e.event);
    expect(eventNames).toEqual(['ServerAdded', 'ServerUpdated', 'ServerDeleted']);
  });

  it('deployment lifecycle: add → remove', async () => {
    await service.addServer(makeServer());

    const dep = makeDeployment();
    const addResult = await service.addDeployment('srv-1', dep);
    expect(addResult.ok).toBe(true);

    // Verify deployment is in the repo
    const srv = service.getServer('srv-1');
    expect(srv?.deployments).toHaveLength(1);

    const rmResult = await service.removeDeployment('srv-1', 'dep-1');
    expect(rmResult.ok).toBe(true);
    expect(service.getServer('srv-1')?.deployments).toHaveLength(0);
  });

  it('external change detection', async () => {
    await service.addServer(makeServer());

    // Simulate external edit
    const configPath = path.join(tmpDir, '.vscode', 'jsm.servers.json');
    const content = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    content.servers[0].name = 'Externally Changed';
    await fs.writeFile(configPath, JSON.stringify(content, null, 2));

    const dirty = await service.checkForExternalChanges();
    expect(dirty).toBe(true);
  });
});

describe('WorkspaceServiceRegistry.addServer', () => {
  let tmpDir: string;
  let configService: ConfigService;
  let registry: WorkspaceServiceRegistry;
  const workspaceUri = 'file:///test-ws';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-registry-'));
    await fs.mkdir(path.join(tmpDir, '.vscode'), { recursive: true });

    const logger = mockLogger();
    const repo = new ConfigRepo(tmpDir, logger);
    const bus = new EventBus(logger);
    const validator = new SchemaValidator();
    validator.addSchema('server-config', { type: 'object' });

    configService = new ConfigService({
      repo,
      validator,
      bus,
      logger,
      workspaceFolderUri: workspaceUri,
    });

    registry = new WorkspaceServiceRegistry(
      [
        {
          scope: { uri: workspaceUri, name: 'test-ws', fsPath: tmpDir },
          configService,
          provisioningService: {} as any,
          configFilePath: path.join(tmpDir, '.vscode', 'jsm.servers.json'),
        },
      ],
      logger,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('delegates to configService.addServer and persists server', async () => {
    const config = makeServer('srv-new', 'New Server');
    const result = await registry.addServer(workspaceUri, config);

    expect(result.ok).toBe(true);
    expect(configService.getServer('srv-new')).toBeDefined();
    expect(configService.getServer('srv-new')?.name).toBe('New Server');
  });

  it('propagates addServer errors (e.g. duplicate id)', async () => {
    const config = makeServer('srv-dup', 'First');
    const first = await registry.addServer(workspaceUri, config);
    expect(first.ok).toBe(true);

    const second = await registry.addServer(workspaceUri, config);
    expect(second.ok).toBe(false);
    expect(second.error?.message).toContain('already exists');
  });

  it('returns error when workspace is not registered', async () => {
    const config = makeServer();
    const result = await registry.addServer('file:///unknown-workspace', config);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('not registered');
  });
});

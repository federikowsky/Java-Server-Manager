/**
 * Extended coverage: WorkspaceServiceRegistry multi-workspace and key parsing (Stateful / Negative / Corner).
 * Maps to feature F-WORKSPACE-REGISTRY.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  WorkspaceServiceRegistry,
  makeWorkspaceServerKey,
} from '@app/config';
import { ConfigService } from '@app/config/ConfigService';
import { ConfigRepo } from '@infra/fs/ConfigRepo';
import { EventBus } from '@core/events/EventBus';
import { SchemaValidator } from '@core/validation/SchemaValidator';
import type { Logger } from '@core/types/logger';
import type { ServerConfig } from '@core/types/domain';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => mockLogger() };
}

function makeServer(id: string, name: string): ServerConfig {
  return {
    id: id as ServerConfig['id'],
    name,
    type: 'tomcat',
    runtime: { id: 'rt-1', homePath: '/opt/tomcat', version: '10' },
    instancePath: '/tmp/i',
    javaHome: '/usr/lib/jvm',
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

describe('WorkspaceServiceRegistry (extended)', () => {
  let tmpA: string;
  let tmpB: string;
  let busA: EventBus;
  let busB: EventBus;
  const uriA = 'file:///workspace-a';
  const uriB = 'file:///workspace-b';

  beforeEach(async () => {
    tmpA = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-wsr-a-'));
    tmpB = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-wsr-b-'));
    await fs.mkdir(path.join(tmpA, '.vscode'), { recursive: true });
    await fs.mkdir(path.join(tmpB, '.vscode'), { recursive: true });
    busA = new EventBus(mockLogger());
    busB = new EventBus(mockLogger());
  });

  afterEach(async () => {
    busA.dispose();
    busB.dispose();
    await fs.rm(tmpA, { recursive: true, force: true });
    await fs.rm(tmpB, { recursive: true, force: true });
  });

  function buildRegistry(): WorkspaceServiceRegistry {
    const logger = mockLogger();
    const v = new SchemaValidator();
    v.addSchema('server-config', { type: 'object' });

    const svcA = new ConfigService({
      repo: new ConfigRepo(tmpA, logger),
      validator: v,
      bus: busA,
      logger,
      workspaceFolderUri: uriA,
    });
    const svcB = new ConfigService({
      repo: new ConfigRepo(tmpB, logger),
      validator: v,
      bus: busB,
      logger,
      workspaceFolderUri: uriB,
    });

    return new WorkspaceServiceRegistry(
      [
        {
          scope: { uri: uriA, name: 'a', fsPath: tmpA },
          configService: svcA,
          provisioningService: {} as never,
          configFilePath: path.join(tmpA, '.vscode', 'jsm.servers.json'),
        },
        {
          scope: { uri: uriB, name: 'b', fsPath: tmpB },
          configService: svcB,
          provisioningService: {} as never,
          configFilePath: path.join(tmpB, '.vscode', 'jsm.servers.json'),
        },
      ],
      logger,
    );
  }

  it('EXT-WSR-001: getWorkspaceScopes returns all registered folders', () => {
    const reg = buildRegistry();
    const scopes = reg.getWorkspaceScopes();
    expect(scopes.map(s => s.uri).sort()).toEqual([uriA, uriB].sort());
  });

  it('EXT-WSR-002: getAllServers aggregates both workspaces', async () => {
    const reg = buildRegistry();
    await reg.addServer(uriA, makeServer('s-a', 'A'));
    await reg.addServer(uriB, makeServer('s-b', 'B'));
    const all = reg.getAllServers();
    expect(all).toHaveLength(2);
    const keys = new Set(all.map(r => r.serverKey));
    expect(keys.has(makeWorkspaceServerKey(uriA, 's-a'))).toBe(true);
    expect(keys.has(makeWorkspaceServerKey(uriB, 's-b'))).toBe(true);
  });

  it('EXT-WSR-003: reloadAll fails when any workspace config is corrupt', async () => {
    const reg = buildRegistry();
    await reg.addServer(uriA, makeServer('ok', 'OK'));
    await reg.addServer(uriB, makeServer('also', 'B'));
    await fs.writeFile(path.join(tmpB, '.vscode', 'jsm.servers.json'), '{broken', 'utf-8');
    const r = await reg.reloadAll();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('b');
    }
  });

  it('EXT-WSR-004: reloadAll succeeds when both configs valid', async () => {
    const reg = buildRegistry();
    await reg.addServer(uriA, makeServer('x', 'X'));
    const r = await reg.reloadAll();
    expect(r.ok).toBe(true);
  });

  it('EXT-WSR-005: getServerRecordByKey bare id does not match workspace-scoped entries', async () => {
    const logger = mockLogger();
    const v = new SchemaValidator();
    v.addSchema('server-config', { type: 'object' });
    const svc = new ConfigService({
      repo: new ConfigRepo(tmpA, logger),
      validator: v,
      bus: busA,
      logger,
      workspaceFolderUri: uriA,
    });
    const reg = new WorkspaceServiceRegistry(
      [
        {
          scope: { uri: uriA, name: 'a', fsPath: tmpA },
          configService: svc,
          provisioningService: {} as never,
          configFilePath: path.join(tmpA, '.vscode', 'jsm.servers.json'),
        },
      ],
      logger,
    );
    await reg.addServer(uriA, makeServer('bare', 'Bare'));
    const rec = reg.getServerRecordByKey('bare');
    expect(rec).toBeUndefined();
  });

  it('EXT-WSR-006: server key with :: in serverId parses using last separator (documented corner)', async () => {
    const logger = mockLogger();
    const v = new SchemaValidator();
    v.addSchema('server-config', { type: 'object' });
    const svc = new ConfigService({
      repo: new ConfigRepo(tmpA, logger),
      validator: v,
      bus: busA,
      logger,
      workspaceFolderUri: uriA,
    });
    const reg = new WorkspaceServiceRegistry(
      [
        {
          scope: { uri: uriA, name: 'a', fsPath: tmpA },
          configService: svc,
          provisioningService: {} as never,
          configFilePath: path.join(tmpA, '.vscode', 'jsm.servers.json'),
        },
      ],
      logger,
    );
    const compositeId = 'part1::part2' as ServerConfig['id'];
    await reg.addServer(uriA, makeServer(compositeId, 'Weird'));
    const key = makeWorkspaceServerKey(uriA, compositeId);
    const rec = reg.getServerRecordByKey(key);
    // lastIndexOf('::') splits key into workspaceFolderUri + serverId
    expect(rec).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConfigRepo } from '@infra/fs/ConfigRepo';
import type { Logger } from '@core/types/logger';
import type { ServerConfig } from '@core/types';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function minimalServer(id: string, name: string): ServerConfig {
  return {
    id,
    name,
    type: 'tomcat',
    runtime: { id: 'r1', homePath: '/opt/tomcat' },
    instancePath: '/tmp/base',
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

describe('ConfigRepo', () => {
  let tmpDir: string;
  let repo: ConfigRepo;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-config-'));
    repo = new ConfigRepo(tmpDir, mockLogger());
    // Create .vscode dir
    await fs.mkdir(path.join(tmpDir, '.vscode'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('load returns empty array when no config file', async () => {
    const result = await repo.load();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('save + load round-trips a server config', async () => {
    const server = minimalServer('s1', 'Test Server');
    await repo.save(server);

    // Reload from disk
    const repo2 = new ConfigRepo(tmpDir, mockLogger());
    const result = await repo2.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].name).toBe('Test Server');
  });

  it('delete removes a server', async () => {
    const s1 = minimalServer('s1', 'Server 1');
    const s2 = minimalServer('s2', 'Server 2');
    await repo.save(s1);
    await repo.save(s2);
    await repo.delete('s1');

    const all = repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('s2');
  });

  it('get returns undefined for unknown ID', async () => {
    expect(repo.get('nonexistent')).toBeUndefined();
  });

  it('isDirty detects external file changes', async () => {
    const server = minimalServer('s1', 'Test');
    await repo.save(server);

    // Simulate external edit
    const configPath = path.join(tmpDir, '.vscode', 'jsm.servers.json');
    await fs.writeFile(configPath, '{"servers":[]}', 'utf-8');

    expect(await repo.isDirty()).toBe(true);
  });

  it('isDirty returns false when file unchanged', async () => {
    const server = minimalServer('s1', 'Test');
    await repo.save(server);
    expect(await repo.isDirty()).toBe(false);
  });

  it('serializes concurrent writes', async () => {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(repo.save(minimalServer(`s${i}`, `Server ${i}`)));
    }
    const results = await Promise.all(promises);
    // All should succeed
    for (const r of results) {
      expect(r.ok).toBe(true);
    }
    expect(repo.getAll()).toHaveLength(5);
  });
});

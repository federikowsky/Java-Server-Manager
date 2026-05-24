/**
 * INFRA-008: Config file exists but is not valid JSON → ConfigReadFailed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ConfigRepo } from '@infra/fs/ConfigRepo';
import type { Logger } from '@core/types/logger';
import { ErrorCode } from '@core/errors/codes';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('ConfigRepo negative paths (extended)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-cfgneg-'));
    await fs.mkdir(path.join(tmpDir, '.vscode'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('INFRA-008: load fails with ConfigReadFailed when JSON is invalid', async () => {
    const configPath = path.join(tmpDir, '.vscode', 'jsm.servers.json');
    await fs.writeFile(configPath, '{ not valid json', 'utf-8');

    const repo = new ConfigRepo(tmpDir, mockLogger());
    const result = await repo.load();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.ConfigReadFailed);
      expect(result.error.message).toContain('parse');
    }
  });

  it('rejects duplicate server ids before mutating the live cache', async () => {
    const configPath = path.join(tmpDir, '.vscode', 'jsm.servers.json');
    await fs.writeFile(configPath, JSON.stringify({
      servers: [
        { id: 'srv-1', name: 'A' },
        { id: 'srv-1', name: 'B' },
      ],
    }), 'utf-8');

    const repo = new ConfigRepo(tmpDir, mockLogger());
    const result = await repo.load();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain("Duplicate server id 'srv-1'");
    }
    expect(repo.getAll()).toEqual([]);
  });

  it('rejects newer workspace config versions before mutating the live cache', async () => {
    const configPath = path.join(tmpDir, '.vscode', 'jsm.servers.json');
    await fs.writeFile(configPath, JSON.stringify({
      version: 999,
      servers: [],
    }), 'utf-8');

    const repo = new ConfigRepo(tmpDir, mockLogger());
    const result = await repo.load();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('newer than this extension supports');
    }
    expect(repo.getAll()).toEqual([]);
  });

  it('rejects non-integer workspace config versions before mutating the live cache', async () => {
    const configPath = path.join(tmpDir, '.vscode', 'jsm.servers.json');
    await fs.writeFile(configPath, JSON.stringify({
      version: '1',
      servers: [],
    }), 'utf-8');

    const repo = new ConfigRepo(tmpDir, mockLogger());
    const result = await repo.load();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('version must be an integer');
    }
    expect(repo.getAll()).toEqual([]);
  });

  it('rejects configs whose servers property is not an array', async () => {
    const configPath = path.join(tmpDir, '.vscode', 'jsm.servers.json');
    await fs.writeFile(configPath, JSON.stringify({
      version: 1,
      servers: {},
    }), 'utf-8');

    const repo = new ConfigRepo(tmpDir, mockLogger());
    const result = await repo.load();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.InvalidConfig);
      expect(result.error.message).toContain('"servers" array');
    }
    expect(repo.getAll()).toEqual([]);
  });

  it('treats a deleted config file as dirty when content was previously loaded', async () => {
    const configPath = path.join(tmpDir, '.vscode', 'jsm.servers.json');
    await fs.writeFile(configPath, JSON.stringify({
      servers: [
        {
          id: 'srv-1',
          name: 'A',
          type: 'tomcat',
          runtime: { id: 'rt-1', homePath: '/opt/tomcat' },
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
        },
      ],
    }), 'utf-8');

    const repo = new ConfigRepo(tmpDir, mockLogger());
    const loadResult = await repo.load();
    expect(loadResult.ok).toBe(true);

    await fs.rm(configPath, { force: true });

    expect(await repo.isDirty()).toBe(true);
  });
});

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
});

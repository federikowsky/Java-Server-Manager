import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PidManager } from '@infra/pid/PidManager';
import type { Logger } from '@core/types/logger';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('PidManager', () => {
  let tmpDir: string;
  let pm: PidManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-pid-'));
    pm = new PidManager(tmpDir, mockLogger());
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads a PID file', async () => {
    await pm.writePid('s1', 42);
    const pid = await pm.readPid('s1');
    expect(pid).toBe(42);
  });

  it('returns undefined for missing PID', async () => {
    const pid = await pm.readPid('missing');
    expect(pid).toBeUndefined();
  });

  it('clears a PID file', async () => {
    await pm.writePid('s1', 100);
    await pm.clearPid('s1');
    const pid = await pm.readPid('s1');
    expect(pid).toBeUndefined();
  });

  it('clearPid is idempotent', async () => {
    // No error when clearing a non-existent PID
    await pm.clearPid('nonexistent');
    expect(true).toBe(true);
  });

  it('isProcessAlive returns true for own process', () => {
    // process.pid is always alive
    expect(pm.isProcessAlive(process.pid)).toBe(true);
  });

  it('isProcessAlive returns false for impossible PID', () => {
    // A very high PID is unlikely to exist
    expect(pm.isProcessAlive(9999999)).toBe(false);
  });
});

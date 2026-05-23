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

  it('writes and reads PID ownership metadata', async () => {
    await pm.writePid('s1', 42, {
      instancePath: '/managed/s1',
      runtimeHomePath: '/opt/tomcat',
    });

    const record = await pm.readPidRecord('s1');

    expect(record).toMatchObject({
      pid: 42,
      serverKey: 's1',
      instancePath: '/managed/s1',
      runtimeHomePath: '/opt/tomcat',
    });
    expect(record?.writtenAt).toEqual(expect.any(Number));
  });

  it('does not consider a record current when process start token changed', async () => {
    await pm.writePid('s1', process.pid, {
      instancePath: '/managed/s1',
      runtimeHomePath: '/opt/tomcat',
    });
    const record = await pm.readPidRecord('s1');
    expect(record).toBeDefined();

    const current = pm.isPidRecordCurrent({
      ...record!,
      processStartToken: 'different-start-token',
    });

    expect(current).toBe(false);
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

  it('writes and reads a PID file for a composite workspace server key', async () => {
    const compositeKey = 'file:/Users/federicofilippi/.mcp/mcp-councilor::66940821-6613-4fff-9587-3e86c2544ab6';

    await pm.writePid(compositeKey, 321);

    const pid = await pm.readPid(compositeKey);
    expect(pid).toBe(321);

    const entries = await fs.readdir(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].endsWith('.pid')).toBe(true);
    expect(entries[0].includes('/')).toBe(false);
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

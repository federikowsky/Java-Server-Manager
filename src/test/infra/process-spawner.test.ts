import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessSpawner } from '@infra/process/ProcessSpawner';
import type { Logger } from '@core/types/logger';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('ProcessSpawner', () => {
  let spawner: ProcessSpawner;

  beforeEach(() => {
    spawner = new ProcessSpawner(mockLogger());
  });

  /* ── spawn ───────────────────────────────────────────────────────── */

  describe('spawn', () => {
    it('spawns a process that exits normally', async () => {
      const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        spawner.spawn({
          exe: 'echo',
          args: ['hello'],
          onExit: (code, signal) => resolve({ code, signal }),
        });
      });

      const { code } = await exitPromise;
      expect(code).toBe(0);
    });

    it('captures stdout via onData', async () => {
      const chunks: string[] = [];
      const exitPromise = new Promise<void>((resolve) => {
        spawner.spawn({
          exe: 'echo',
          args: ['hello world'],
          onData: (chunk) => chunks.push(chunk),
          onExit: () => resolve(),
        });
      });

      await exitPromise;
      expect(chunks.join('')).toContain('hello world');
    });

    it('passes environment variables', async () => {
      const chunks: string[] = [];
      const exitPromise = new Promise<void>((resolve) => {
        spawner.spawn({
          exe: 'sh',
          args: ['-c', 'echo $TEST_VAR_JSM'],
          env: { TEST_VAR_JSM: 'custom_value' },
          onData: (chunk) => chunks.push(chunk),
          onExit: () => resolve(),
        });
      });

      await exitPromise;
      expect(chunks.join('')).toContain('custom_value');
    });

    it('reports non-zero exit code', async () => {
      const exitPromise = new Promise<{ code: number | null }>((resolve) => {
        spawner.spawn({
          exe: 'sh',
          args: ['-c', 'exit 42'],
          onExit: (code) => resolve({ code }),
        });
      });

      const { code } = await exitPromise;
      expect(code).toBe(42);
    });

    it('runs a shell command line', async () => {
      const chunks: string[] = [];
      const exitPromise = new Promise<void>((resolve) => {
        spawner.spawnShell({
          line: 'printf "alpha" && printf "-beta"',
          onData: (chunk) => chunks.push(chunk),
          onExit: () => resolve(),
        });
      });

      await exitPromise;
      expect(chunks.join('')).toContain('alpha-beta');
    });
  });

  /* ── isRunning ───────────────────────────────────────────────────── */

  describe('isRunning', () => {
    it('returns true for current process', () => {
      expect(spawner.isRunning(process.pid)).toBe(true);
    });

    it('returns false for non-existent PID', () => {
      // Using a very high PID unlikely to exist
      expect(spawner.isRunning(999999)).toBe(false);
    });
  });

  /* ── kill ─────────────────────────────────────────────────────────── */

  describe('kill', () => {
    it('returns false for non-existent PID', () => {
      expect(spawner.kill(999999)).toBe(false);
    });

    it('kills a spawned process', async () => {
      const child = spawner.spawn({
        exe: 'sleep',
        args: ['60'],
      });

      // Wait a tick for the process to start
      await new Promise(r => setTimeout(r, 50));

      const pid = child.pid!;
      expect(spawner.isRunning(pid)).toBe(true);

      const killed = spawner.kill(pid);
      expect(killed).toBe(true);

      // Wait for process to die
      await new Promise<void>((resolve) => {
        child.on('exit', () => resolve());
      });

      expect(spawner.isRunning(pid)).toBe(false);
    });
  });
});

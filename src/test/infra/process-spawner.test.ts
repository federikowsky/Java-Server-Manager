import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessSpawner } from '@infra/process/ProcessSpawner';
import type { Logger } from '@core/types/logger';

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function nodeCommand(script: string): { exe: string; args: string[] } {
  return {
    exe: process.execPath,
    args: ['-e', script],
  };
}

function nodeShellLine(script: string): string {
  const nodeExe = JSON.stringify(process.execPath.replace(/\\/g, '/'));
  return `${nodeExe} -e ${JSON.stringify(script)}`;
}

describe('ProcessSpawner', () => {
  let spawner: ProcessSpawner;

  beforeEach(() => {
    spawner = new ProcessSpawner(mockLogger());
  });

  /* ── spawn ───────────────────────────────────────────────────────── */

  describe('spawn', () => {
    it('spawns a process that exits normally', async () => {
      const command = nodeCommand('');
      const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        spawner.spawn({
          ...command,
          onExit: (code, signal) => resolve({ code, signal }),
        });
      });

      const { code } = await exitPromise;
      expect(code).toBe(0);
    });

    it('captures stdout via onData', async () => {
      const chunks: string[] = [];
      const command = nodeCommand("process.stdout.write('hello world')");
      const exitPromise = new Promise<void>((resolve) => {
        spawner.spawn({
          ...command,
          onData: (chunk) => chunks.push(chunk),
          onExit: () => resolve(),
        });
      });

      await exitPromise;
      expect(chunks.join('')).toContain('hello world');
    });

    it('passes environment variables', async () => {
      const chunks: string[] = [];
      const command = nodeCommand("process.stdout.write(process.env.TEST_VAR_JSM || '')");
      const exitPromise = new Promise<void>((resolve) => {
        spawner.spawn({
          ...command,
          env: { TEST_VAR_JSM: 'custom_value' },
          onData: (chunk) => chunks.push(chunk),
          onExit: () => resolve(),
        });
      });

      await exitPromise;
      expect(chunks.join('')).toContain('custom_value');
    });

    it('reports non-zero exit code', async () => {
      const command = nodeCommand('process.exit(42)');
      const exitPromise = new Promise<{ code: number | null }>((resolve) => {
        spawner.spawn({
          ...command,
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
          line: nodeShellLine("process.stdout.write('alpha-beta')"),
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
      const command = nodeCommand('setTimeout(() => {}, 60_000)');
      const child = spawner.spawn({
        ...command,
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

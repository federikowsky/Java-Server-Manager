import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as os from 'os';
import type { Logger } from '@core/types/logger';

export interface SpawnOptions {
  /** Executable path or name. */
  exe: string;
  /** Argument array (no shell expansion). */
  args: string[];
  /** Working directory. */
  cwd?: string;
  /** Additional environment variables (merged with process.env). */
  env?: Record<string, string>;
  /** Callback for stdout/stderr data. */
  onData?: (chunk: string) => void;
  /** Callback when process exits. */
  onExit?: (code: number | null, signal: string | null) => void;
}

export interface SpawnShellOptions {
  /** Command line to execute inside the resolved shell. */
  line: string;
  /** Working directory. */
  cwd?: string;
  /** Additional environment variables (merged with process.env). */
  env?: Record<string, string>;
  /** Callback for stdout/stderr data. */
  onData?: (chunk: string) => void;
  /** Callback when process exits. */
  onExit?: (code: number | null, signal: string | null) => void;
}

/**
 * Process spawner with `shell: false` (§12.2).
 * On Windows, wraps via `cmd.exe /d /s /c` with deterministic quoting.
 */
export class ProcessSpawner {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** Spawn a child process. Returns the ChildProcess handle. */
  spawn(opts: SpawnOptions): ChildProcess {
    const isWindows = os.platform() === 'win32';
    const requiresCmd = isWindows && /\.(?:bat|cmd)$/i.test(opts.exe);
    let exe: string;
    let args: string[];
    let windowsVerbatimArguments = false;

    if (requiresCmd) {
      const quoted = [opts.exe, ...opts.args].map(arg => this.quoteCmdArg(arg)).join(' ');
      exe = 'cmd.exe';
      args = ['/d', '/c', quoted];
      windowsVerbatimArguments = true;
    } else {
      exe = opts.exe;
      args = opts.args;
    }

    return this.spawnResolved(exe, args, opts, opts.exe, opts.args, undefined, windowsVerbatimArguments);
  }

  /** Spawn a shell command using the user's default platform shell. */
  spawnShell(opts: SpawnShellOptions): ChildProcess {
    const isWindows = os.platform() === 'win32';
    const exe = isWindows ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || 'sh');
    const args = isWindows ? ['/d', '/c', opts.line] : ['-lc', opts.line];

    return this.spawnResolved(exe, args, opts, exe, args, opts.line, isWindows);
  }

  private spawnResolved(
    exe: string,
    args: string[],
    opts: {
      cwd?: string;
      env?: Record<string, string>;
      onData?: (chunk: string) => void;
      onExit?: (code: number | null, signal: string | null) => void;
    },
    logExe: string,
    logArgs: string[],
    commandLine?: string,
    windowsVerbatimArguments = false,
  ): ChildProcess {

    const env = opts.env
      ? { ...process.env, ...opts.env }
      : process.env;

    this.logger.debug(`ProcessSpawner: spawning ${logExe}`, { args: logArgs, cwd: opts.cwd, commandLine });

    const child = spawn(exe, args, {
      cwd: opts.cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments,
    });

    if (opts.onData) {
      const onData = opts.onData;
      child.stdout?.on('data', (chunk: Buffer) => onData(chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => onData(chunk.toString()));
    }

    if (opts.onExit) {
      const onExit = opts.onExit;
      child.on('exit', (code, signal) => onExit(code, signal));
    }

    child.on('error', (err) => {
      this.logger.error(`ProcessSpawner: spawn error for ${logExe}`, err);
    });

    return child;
  }

  /** Send SIGTERM (or taskkill on Windows). */
  kill(pid: number, force = false): boolean {
    try {
      if (os.platform() === 'win32') {
        const result = spawnSync('taskkill', force ? ['/F', '/T', '/PID', String(pid)] : ['/PID', String(pid)], {
          shell: false,
          stdio: 'ignore',
          windowsHide: true,
        });
        return result.status === 0;
      } else {
        process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
        return true;
      }
    } catch {
      return false;
    }
  }

  /** Check if a process with the given PID is currently running. */
  isRunning(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
      return false;
    }

    if (os.platform() === 'win32') {
      const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      if (result.error || result.status !== 0) {
        return false;
      }
      return result.stdout
        .split(/\r?\n/)
        .some(line => new RegExp(`^"[^"]+","${pid}",`).test(line.trim()));
    }

    try {
      // signal 0 doesn't kill but checks existence
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private quoteCmdArg(arg: string): string {
    if (arg.length === 0) {
      return '""';
    }
    if (!/[\s"]/u.test(arg)) {
      return arg;
    }
    return `"${arg.replace(/"/g, '""')}"`;
  }
}

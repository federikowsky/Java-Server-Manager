/*
 * src/core/server/AbstractRuntime.ts
 * Base class: encapsulates common behaviour for any Java server runtime.
 * Concrete subclasses must implement server‑specific operations.
 */

import { spawn, ChildProcess } from 'child_process';
import { promises as fs, rmSync } from 'fs';
import * as path from 'path';
import { ServerConfig, DeploymentConfig } from '../types/domain';
import { ServerRuntimeInfo } from '../types/runtime';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Logger } from '../utils/logger';

export abstract class AbstractRuntime {
  protected readonly log = Logger.getInstance().createChild(this.constructor.name);
  protected child?: ChildProcess;
  protected readonly info: ServerRuntimeInfo;

  constructor(protected readonly cfg: ServerConfig) {
    this.info = {
      pid: 0,
      pidFile: cfg.pidFile,
      process: undefined as any,
      state: cfg.state,
      mode: 'run',
      deployments: {},
      debugPort: undefined
    } as ServerRuntimeInfo;
  }

  /* ───────────────────── public API ───────────────────── */

  getConfig(): ServerConfig {
    return this.cfg;
  }

  async start(mode: 'run' | 'debug', jdwpPort?: number): Promise<Result<void, JsmError>> {
    if (this.child) return ok(undefined); // already running

    const { cmd, args, env } = this.buildLaunchCommand(mode, jdwpPort);
    this.log.debug(`spawn ${cmd} ${args.join(' ')}`);

    try {
      this.child = spawn(cmd, args, {
        cwd: this.cfg.workingDir ?? this.cfg.serverHome,
        env: { ...process.env, ...this.cfg.envVars, ...env },
        stdio: 'pipe'
      });

      this.info.process = this.child;
      this.info.pid = this.child.pid ?? 0;
      this.info.mode = mode;
      this.info.state = 'starting';
      this.info.debugPort = jdwpPort;

      this.attachProcessIO();

      // simplistic readiness: wait startupTimeout then mark as running
      await new Promise(res => setTimeout(res, this.cfg.startupTimeout ?? 3000));
      this.info.state = 'running';
      return ok(undefined);
    } catch (e) {
      this.info.state = 'error';
      return err(new JsmError(ErrorCode.SERVER_STARTUP_ERROR, 'Failed to spawn runtime', e));
    }
  }

  async stop(): Promise<Result<void, JsmError>> {
    if (!this.child) return ok(undefined);
    try {
      this.child.kill();
      await new Promise(res => setTimeout(res, this.cfg.stopTimeout ?? 3000));
      this.child = undefined;
      this.info.state = 'stopped';
      return ok(undefined);
    } catch (e) {
      return err(new JsmError(ErrorCode.SERVER_SHUTDOWN_ERROR, 'Cannot stop runtime', e));
    }
  }

  async publish(dep: DeploymentConfig, mode: 'incremental' | 'full'): Promise<Result<void, JsmError>> {
    try {
      await this.doPublish(dep, mode);
      return ok(undefined);
    } catch (e) {
      return err(new JsmError(ErrorCode.DEPLOY_ERROR, 'Publish failed', e));
    }
  }

  async undeploy(dep: DeploymentConfig, soft: boolean): Promise<Result<void, JsmError>> {
    try {
      await this.doUndeploy(dep, soft);
      return ok(undefined);
    } catch (e) {
      return err(new JsmError(ErrorCode.UNDEPLOY_ERROR, 'Undeploy failed', e));
    }
  }

  getInfo(): ServerRuntimeInfo { return this.info; }
  async dispose(): Promise<void> { await this.stop(); }

  /* ─────────────────── subclass responsibilities ─────────────────── */

  /**
   * Build command, args and extra env for spawn.
   */
  protected abstract buildLaunchCommand(
    mode: 'run' | 'debug',
    jdwpPort?: number
  ): { cmd: string; args: string[]; env?: Record<string, string> };

  /**
   * Copy WAR/exploded dir into server deployment dir.
   */
  protected abstract doPublish(
    dep: DeploymentConfig,
    mode: 'incremental' | 'full'
  ): Promise<Result<void,JsmError>>;

  /**
   * Remove deployment from server; if soft=true, leave config intact.
   */
  protected abstract doUndeploy(dep: DeploymentConfig, soft: boolean): Promise<Result<void,JsmError>>;

  /* ───────────────────── helpers ───────────────────── */

  protected attachProcessIO(): void {
    if (!this.child) return;
    this.child.stdout?.on('data', d => this.log.info(d.toString().trimEnd()));
    this.child.stderr?.on('data', d => this.log.error(d.toString().trimEnd()));
    this.child.once('exit', code => {
      this.log.warn(`process exited with code ${code}`);
      this.child = undefined;
      this.info.state = 'stopped';
    });
  }

  protected async copyRecursive(src: string, dest: string): Promise<void> {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.cp(src, dest, { recursive: true });
  }

  protected async removeRecursive(p: string): Promise<void> {
    rmSync(p, { recursive: true, force: true });
  }
}

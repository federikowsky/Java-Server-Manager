/*
 * src/core/server/ServerManager.ts
 * Maintains in‑memory map of serverId → AbstractRuntime.
 * Instantiates proper runtime class based on ServerType on demand.
 */

import { ServerConfig } from '../types/domain';
import { AbstractRuntime } from './AbstractRuntime';
import { TomcatRuntime } from './TomcatRuntime';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Logger } from '../utils/logger';

export class ServerManager {
  private readonly log = Logger.getInstance().createChild('SrvMgr');
  private readonly map = new Map<string, AbstractRuntime>();

  register(cfg: ServerConfig): Result<AbstractRuntime, JsmError> {
    if (this.map.has(cfg.id)) return ok(this.map.get(cfg.id)!);
    const runtime = this.createRuntime(cfg);
    if (!runtime) return err(new JsmError(ErrorCode.UNKNOWN, 'Unsupported server type'));
    this.map.set(cfg.id, runtime);
    return ok(runtime);
  }

  get(id: string): Result<AbstractRuntime, JsmError> {
    const rt = this.map.get(id);
    return rt ? ok(rt) : err(new JsmError(ErrorCode.SERVER_NOT_FOUND, 'Runtime not found'));
  }

  unregister(id: string): void {
    const rt = this.map.get(id);
    if (rt) {
      rt.dispose().catch(() => {/* swallow */});
      this.map.delete(id);
    }
  }

  list(): AbstractRuntime[] { return [...this.map.values()]; }

  async disposeAll(): Promise<void> {
    for (const rt of this.map.values()) {
      await rt.dispose().catch(e => this.log.error('dispose runtime', e));
    }
    this.map.clear();
  }

  /* —————————————————————————— helpers —————————————————————————— */
  private createRuntime(cfg: ServerConfig): AbstractRuntime | null {
    switch (cfg.type) {
      case 'tomcat': return new TomcatRuntime(cfg);
      default:       return null;
    }
  }
}

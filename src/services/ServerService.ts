/*
 * src/services/ServerService.ts
 * Orchestrator for all server‑level use cases.
 */

import { Result, ok, err } from '../core/utils/result';
import { ServerConfig, ServerState } from '../core/types/domain';
import { ConfigService } from '../core/config/ConfigService';
import { ServerManager } from '../core/server/ServerManager';
import { EventBus } from '../core/EventBus';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { HookManager } from '../core/hooks/HookManager';
import { Logger } from '../core/utils/logger';
import { PidManager } from '../core/pid/PidManager';
import { DebugManager } from '../core/debug/DebugManager';
import { v4 as uuid } from 'uuid';

export class ServerService {
  private readonly log = Logger.getInstance().createChild('ServerSvc');

  constructor(
    private readonly cfgSvc: ConfigService,
    private readonly pidMgr: PidManager,
    private readonly srvMgr: ServerManager,
    private readonly bus: EventBus,
    private readonly hooks: HookManager,
    private readonly dbgMgr: DebugManager
  ) {}

  /* ───────────────────────── WORKSPACE BOOT ─────────────────────── */
  async loadWorkspace(): Promise<Result<void, JsmError>> {
    const all = this.cfgSvc.loadAll();
    if (!all.ok) return all as any;
    for (const s of all.value) {
      // attempt crash‑recovery from pid file
      if (s.state === 'running') {
        const pid = await this.pidMgr.read(s.pidFile);
        if (pid) {
          // runtime will be created lazily on first operation
          this.log.info(`Recovered running server ${s.name} (pid ${pid})`);
        } else {
          s.state = 'stopped';
        }
      }
      this.bus.emit('ServerAdded', s);
    }
    this.bus.emit('ConfigLoaded', { servers: all.value });
    return ok(undefined);
  }

  /* ───────────────────────── CRUD ──────────────────────────────── */
  async create(draft: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
    const cfg: ServerConfig = {
      ...draft,
      id: uuid(),
      state: 'stopped'
    } as ServerConfig;

    const r = this.cfgSvc.upsertServer(cfg);
    if (!r.ok) return r as any;
    this.bus.emit('ServerAdded', cfg);
    await this.hooks.invoke('afterAddServer', cfg);
    return ok(cfg);
  }

  async update(draft: ServerConfig): Promise<Result<ServerConfig, JsmError>> {
    const r = this.cfgSvc.upsertServer(draft);
    if (!r.ok) return r as any;
    this.bus.emit('ServerUpdated', draft);
    await this.hooks.invoke('afterAddServer', draft);
    return ok(draft);
  }

  async delete(id: string): Promise<Result<void, JsmError>> {
    await this.hooks.invoke('beforeDeleteServer', id);
    const res = this.cfgSvc.deleteServer(id);
    if (!res.ok) return res;
    this.srvMgr.unregister(id);
    await this.pidMgr.remove(`${id}.pid`);
    this.bus.emit('ServerDeleted', { id });
    await this.hooks.invoke('afterDeleteServer', id);
    return ok(undefined);
  }

  get(id: string) {
    const all = this.cfgSvc.loadAll();
    if (!all.ok) {
      return err(all.error);
    }
    const server = all.value.find(s => s.id === id);
    if (server) {
      return ok(server);
    } else {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, 'not found'));
    }
  }

  /* ───────────────────────── LIFECYCLE ─────────────────────────── */
  async start(id: string, mode: 'run' | 'debug'): Promise<Result<void, JsmError>> {
    await this.hooks.invoke('beforeStartServer', id, mode);
    const runtimeRes = this.srvMgr.get(id);
    if (!runtimeRes.ok) return runtimeRes;
    const runtime = runtimeRes.value;

    let port: number | undefined;
    if (mode === 'debug') port = await this.dbgMgr.findFreePort();

    const startRes = await runtime.start(mode, port);
    if (!startRes.ok) return startRes;

    if (mode === 'debug' && port) {
      const name = await this.dbgMgr.generateLaunchConfig(id, port);
      await this.dbgMgr.attachDebugger(name);
    }

    this.bus.emit('ServerStateChanged', { id, state: 'running' });
    await this.hooks.invoke('afterStartServer', id);
    return ok(undefined);
  }

  async stop(id: string): Promise<Result<void, JsmError>> {
    await this.hooks.invoke('beforeStopServer', id);
    const runtimeRes = this.srvMgr.get(id);
    if (!runtimeRes.ok) return runtimeRes;
    const stopRes = await runtimeRes.value.stop();
    if (!stopRes.ok) return stopRes;
    this.bus.emit('ServerStateChanged', { id, state: 'stopped' });
    await this.hooks.invoke('afterStopServer', id);
    return ok(undefined);
  }

  async restart(id: string, mode: 'run' | 'debug'): Promise<Result<void, JsmError>> {
    await this.hooks.invoke('beforeStopServer', id);
    const stop = await this.stop(id);
    if (!stop.ok) this.log.warn(`Stop before restart failed: ${stop.error.message}`);
    return this.start(id, mode);
  }

  async stopAllRunning(): Promise<void> {
    const all = this.cfgSvc.loadAll();
    if (!all.ok) return;
    for (const s of all.value.filter(x => x.state === 'running')) {
      await this.stop(s.id);
    }
  }
}

/*
 * src/services/DeploymentService.ts
 * Handles full deployment lifecycle orchestration.
 */

import { DeploymentConfig, ServerConfig } from '../core/types/domain';
import { Result, ok, err } from '../core/utils/result';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { ServerManager } from '../core/server/ServerManager';
import { ConfigService } from '../core/config/ConfigService';
import { DeploymentManager } from '../core/deployment/DeploymentManager';
import { EventBus } from '../core/EventBus';
import { HookManager } from '../core/hooks/HookManager';
import { Logger } from '../core/utils/logger';

export class DeploymentService {
  private readonly log = Logger.getInstance().createChild('DepSvc');
  private readonly managers = new Map<string, DeploymentManager>(); // srvId → DeploymentManager

  constructor(
    private readonly cfgSvc: ConfigService,
    private readonly srvMgr: ServerManager,
    private readonly bus: EventBus,
    private readonly hooks: HookManager
  ) {}

  /* ───────────────────── helpers ───────────────────── */
  private getManager(serverId: string): DeploymentManager {
    let m = this.managers.get(serverId);
    if (!m) {
      m = new DeploymentManager(serverId);
      this.managers.set(serverId, m);
    }
    return m;
  }

  private serverConfig(id: string): Result<ServerConfig, JsmError> {
    const res = this.cfgSvc.loadAll();
    if (!res.ok) return err(res.error);
    const s = res.value.find(x => x.id === id);
    return s ? ok(s) : err(new JsmError(ErrorCode.SERVER_NOT_FOUND, 'server missing'));
  }

  /* ───────────────────── public API ─────────────────── */
  async add(srvId: string, draft: DeploymentConfig): Promise<Result<DeploymentConfig, JsmError>> {
    await this.hooks.invoke('beforeAddDeployment', srvId);
    const m = this.getManager(srvId);
    const addRes = m.add(draft);
    if (!addRes.ok) return addRes;
    const saveRes = this.cfgSvc.upsertDeployment(srvId, addRes.value);
    if (!saveRes.ok) return err(saveRes.error);
    this.bus.emit('DeploymentAdded', addRes.value);
    await this.hooks.invoke('afterAddDeployment', addRes.value);
    return addRes;
  }

  async remove(srvId: string, depId: string, hard: boolean): Promise<Result<void, JsmError>> {
    const mgr = this.getManager(srvId);
    const depRes = mgr.get(depId);
    if (!depRes.ok) return err(depRes.error);
    await this.hooks.invoke('beforeRemoveDeployment', depRes.value);

    if (hard) {
      const cfgRes = this.cfgSvc.deleteDeployment(srvId, depId);
      if (!cfgRes.ok) return cfgRes;
    }

    const svr = this.srvMgr.get(srvId);
    if (svr.ok) await svr.value.undeploy(depRes.value, true);

    mgr.remove(depId);
    this.bus.emit('DeploymentRemoved', depRes.value);
    await this.hooks.invoke('afterRemoveDeployment', depRes.value);
    return ok(undefined);
  }

  async forceDeploy(srvId: string, depId: string): Promise<Result<void, JsmError>> {
    const mgr = this.getManager(srvId);
    const depRes = mgr.get(depId);
    if (!depRes.ok) return err(depRes.error);

    const rtRes = this.srvMgr.get(srvId);
    if (!rtRes.ok) return err(rtRes.error);

    const pubRes = await rtRes.value.publish(depRes.value, 'full');
    if (!pubRes.ok) return pubRes;

    this.bus.emit('DeploymentStateChanged', { srvId, depId, state: 'synced' });
    return ok(undefined);
  }

  async publishServer(srvId: string, mode: 'incremental'|'full'): Promise<Result<void, JsmError>> {
    const srv = this.serverConfig(srvId);
    if (!srv.ok) return err(srv.error);
    for (const d of srv.value.deployments) {
      const res = mode === 'full' ? await this.forceDeploy(srvId, d.id) : await this.publishIncremental(srvId, d.id);
      if (!res.ok) return res;
    }
    this.bus.emit('ServerPublished', { id: srvId, mode });
    return ok(undefined);
  }

  async publishIncremental(srvId: string, depId: string): Promise<Result<void, JsmError>> {
    const mgr = this.getManager(srvId);
    const depRes = mgr.get(depId);
    if (!depRes.ok) return err(depRes.error);

    const rtRes = this.srvMgr.get(srvId);
    if (!rtRes.ok) return err(rtRes.error);

    const pub = await rtRes.value.publish(depRes.value, 'incremental');
    if (!pub.ok) return pub;

    this.bus.emit('DeploymentStateChanged', { srvId, depId, state: 'synced' });
    return ok(undefined);
  }

  async undeploySoft(args: { serverId: string; deploymentId: string }): Promise<Result<void, JsmError>> {
    const { serverId, deploymentId } = args;
    const mgr = this.getManager(serverId);
    const depRes = mgr.get(deploymentId);
    if (!depRes.ok) return err(depRes.error);

    const rt = this.srvMgr.get(serverId);
    if (!rt.ok) return err(rt.error);

    const res = await rt.value.undeploy(depRes.value, true);
    if (!res.ok) return res;

    this.bus.emit('DeploymentUndeployed', depRes.value);
    return ok(undefined);
  }

  get(srvId: string, depId: string): Result<DeploymentConfig, JsmError> {
    return this.getManager(srvId).get(depId);
  }
}

/*
 * DeploymentService - KISS approach with ConfigManager
 * Handles deployment lifecycle orchestration using plugin system
 */

import { DeploymentConfig, ServerConfig } from '../core/types/domain';
import { Result, ok, err } from '../core/utils/result';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { PluginRegistry } from '../core/server/plugins/index';
import { ConfigManager } from '../core/config/ConfigManager';
import { DeploymentManager } from '../core/deployment/DeploymentManager';
import { EventBus } from '../core/EventBus';
import { HookManager } from '../core/hooks/HookManager';
import { Logger } from '../core/utils/logger';

export class DeploymentService {
  private readonly log = Logger.getInstance().createChild('DeploymentService');
  private readonly managers = new Map<string, DeploymentManager>(); // srvId → DeploymentManager

  constructor(
    private readonly configManager: ConfigManager,
    private readonly pluginRegistry: PluginRegistry,
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

  private async serverConfig(id: string): Promise<Result<ServerConfig, JsmError>> {
    const serverResult = await this.configManager.getServer(id);
    if (!serverResult.ok) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, 'server missing'));
    }
    return serverResult;
  }

  /* ───────────────────── public API ─────────────────── */
  async add(srvId: string, draft: DeploymentConfig): Promise<Result<DeploymentConfig, JsmError>> {
    await this.hooks.invoke('beforeAddDeployment', srvId);
    
    // Get server config to extract serverHome for auto-generation
    const serverRes = await this.serverConfig(srvId);
    if (!serverRes.ok) return serverRes as any;
    
    // Use instancePath if available (for instance-based servers), otherwise fallback to serverHome
    const effectivePath = (serverRes.value as any).instancePath || serverRes.value.serverHome;
    
    // Simple deployment config creation
    const deploymentConfig: DeploymentConfig = {
      ...draft,
      id: draft.id || `dep_${Date.now()}`,
      name: draft.name || 'New Deployment',
      type: draft.type || 'war',
      state: 'undeployed'
    };
    
    const m = this.getManager(srvId);
    const addRes = m.add(deploymentConfig);
    if (!addRes.ok) return addRes;
    
    // Save deployment using ConfigManager
    const saveRes = await this.configManager.addDeployment(srvId, addRes.value);
    if (!saveRes.ok) return saveRes as any;
    
    this.bus.emit('DeploymentAdded', addRes.value);
    await this.hooks.invoke('afterAddDeployment', addRes.value);
    return addRes;
  }

  async remove(srvId: string, depId: string, hard: boolean): Promise<Result<void, JsmError>> {
    const m = this.getManager(srvId);
    
    // Get deployment config before removing
    const deploymentRes = m.get(depId);
    if (!deploymentRes.ok) return deploymentRes as any;

    if (hard) {
      // Use plugin to undeploy from server
      const serverRes = await this.serverConfig(srvId);
      if (!serverRes.ok) return serverRes as any;

      const pluginRes = this.pluginRegistry.get(serverRes.value.type);
      if (pluginRes.ok) {
        const undeployRes = await pluginRes.value.undeploy(serverRes.value, depId);
        if (!undeployRes.ok) {
          this.log.warn(`Plugin undeploy failed: ${undeployRes.error.message}`);
        }
      }
    }

    const removeRes = m.remove(depId);
    if (!removeRes.ok) return removeRes;

    // Delete deployment using ConfigManager
    const cfgRes = await this.configManager.deleteDeployment(srvId, depId);
    if (!cfgRes.ok) return cfgRes;

    this.bus.emit('DeploymentRemoved', deploymentRes.value);
    await this.hooks.invoke('afterRemoveDeployment', deploymentRes.value);
    return ok(undefined);
  }

  async publish(srvId: string, depId: string): Promise<Result<void, JsmError>> {
    const serverRes = await this.serverConfig(srvId);
    if (!serverRes.ok) return serverRes as any;

    const pluginRes = this.pluginRegistry.get(serverRes.value.type);
    if (!pluginRes.ok) return pluginRes as any;

    const m = this.getManager(srvId);
    const dep = m.get(depId);
    if (!dep.ok) return dep as any;

    const publishRes = await pluginRes.value.deploy(serverRes.value, dep.value);
    if (!publishRes.ok) return publishRes;

    // Update deployment state
    dep.value.state = 'synced';
    await this.configManager.updateDeployment(srvId, dep.value.id, dep.value);

    this.bus.emit('DeploymentAdded', dep.value);
    return ok(undefined);
  }

  async publishIncremental(srvId: string, depId: string): Promise<Result<void, JsmError>> {
    const serverRes = await this.serverConfig(srvId);
    if (!serverRes.ok) return serverRes as any;

    const pluginRes = this.pluginRegistry.get(serverRes.value.type);
    if (!pluginRes.ok) return pluginRes as any;

    const m = this.getManager(srvId);
    const dep = m.get(depId);
    if (!dep.ok) return dep as any;

    // Use incremental deployment if supported
    if ('deployIncremental' in pluginRes.value) {
      const incrementalRes = await (pluginRes.value as any).deployIncremental(srvId, dep.value);
      if (!incrementalRes.ok) return incrementalRes;
    } else {
      // Fallback to full deployment
      const deployRes = await pluginRes.value.deploy(serverRes.value, dep.value);
      if (!deployRes.ok) return deployRes;
    }

    // Update deployment state
    dep.value.state = 'synced';
    await this.configManager.updateDeployment(srvId, dep.value.id, dep.value);

    this.bus.emit('DeploymentAdded', dep.value);
    return ok(undefined);
  }

  async undeploy(srvId: string, depId: string): Promise<Result<void, JsmError>> {
    const serverRes = await this.serverConfig(srvId);
    if (!serverRes.ok) return serverRes as any;

    const pluginRes = this.pluginRegistry.get(serverRes.value.type);
    if (!pluginRes.ok) return pluginRes as any;

    const m = this.getManager(srvId);
    const dep = m.get(depId);
    if (!dep.ok) return dep as any;

    const undeployRes = await pluginRes.value.undeploy(serverRes.value, depId);
    if (!undeployRes.ok) return undeployRes;

    // Update deployment state
    dep.value.state = 'undeployed';
    await this.configManager.updateDeployment(srvId, dep.value.id, dep.value);

    this.bus.emit('DeploymentUndeployed', dep.value);
    return ok(undefined);
  }

  list(srvId: string): DeploymentConfig[] {
    const m = this.getManager(srvId);
    return m.getAll();
  }

  get(srvId: string, depId: string): Result<DeploymentConfig, JsmError> {
    const m = this.getManager(srvId);
    return m.get(depId);
  }

  /* ───────────────────── cleanup ─────────────────── */
  disposeAll(): void {
    this.managers.clear();
    this.log.debug('All deployment managers disposed');
  }
}

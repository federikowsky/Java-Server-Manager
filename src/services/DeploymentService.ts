/*
 * DeploymentService - Streamlined deployment orchestration following KISS principles
 * Single responsibility: Deploy, undeploy, and manage deployment lifecycle
 */

import { DeploymentConfig, ServerConfig } from '../core/types/domain';
import { Result, ok, err } from '../core/utils/result';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { PluginRegistry } from '../core/server/plugins/index';
import { ConfigManager } from '../core/config/ConfigManager';
import { EventBus } from '../core/EventBus';
import { HookManager } from '../core/hooks/HookManager';
import { Logger } from '../core/utils/logger';
import { SchemaValidator } from '../core/validation/SchemaValidator';
import * as fs from 'fs';

export class DeploymentService {
  private readonly log = Logger.getInstance().createChild('DeploymentService');
  private readonly schemaValidator = SchemaValidator.getInstance();

  constructor(
    private readonly configManager: ConfigManager,
    private readonly pluginRegistry: PluginRegistry,
    private readonly bus: EventBus,
    private readonly hooks: HookManager
  ) {}

  /* ───────────────────── Configuration Operations ─────────────────── */

  async add(serverId: string, draft: DeploymentConfig): Promise<Result<DeploymentConfig, JsmError>> {
    await this.hooks.invoke('beforeAddDeployment', serverId);
    
    const serverResult = await this.getServerConfig(serverId);
    if (!serverResult.ok) return serverResult as any;

    const deploymentConfig = this.buildDeploymentConfig(draft, serverResult.value);
    
    // Validate deployment configuration
    const validationResult = await this.validateDeployment(deploymentConfig);
    if (!validationResult.ok) return validationResult as any;
    
    const saveResult = await this.configManager.addDeployment(serverId, deploymentConfig);
    if (!saveResult.ok) return saveResult as any;

    this.bus.emit('DeploymentAdded', deploymentConfig);
    await this.hooks.invoke('afterAddDeployment', deploymentConfig);
    
    return ok(deploymentConfig);
  }

  async remove(serverId: string, deploymentId: string, hardDelete: boolean = false): Promise<Result<void, JsmError>> {
    const deploymentResult = await this.getDeployment(serverId, deploymentId);
    if (!deploymentResult.ok) return deploymentResult as any;

    if (hardDelete) {
      const undeployResult = await this.undeploy(serverId, deploymentId);
      if (!undeployResult.ok) {
        this.log.warn(`Hard delete: undeploy failed for ${deploymentId}: ${undeployResult.error.message}`);
      }
    }

    const deleteResult = await this.configManager.deleteDeployment(serverId, deploymentId);
    if (!deleteResult.ok) return deleteResult;

    this.bus.emit('DeploymentRemoved', deploymentResult.value);
    await this.hooks.invoke('afterRemoveDeployment', deploymentResult.value);
    
    return ok(undefined);
  }

  /* ───────────────────── Deployment Operations ─────────────────── */

  async publish(serverId: string, deploymentId: string, mode: 'full' | 'incremental' = 'full'): Promise<Result<void, JsmError>> {
    const [serverResult, deploymentResult] = await Promise.all([
      this.getServerConfig(serverId),
      this.getDeployment(serverId, deploymentId)
    ]);

    if (!serverResult.ok) return serverResult as any;
    if (!deploymentResult.ok) return deploymentResult as any;

    // Detect server type from serverHome since type field was removed
    const typeResult = await this.pluginRegistry.detectServerType(serverResult.value.serverHome);
    if (!typeResult.ok) return typeResult as any;

    const pluginResult = this.pluginRegistry.get(typeResult.value);
    if (!pluginResult.ok) return pluginResult as any;

    let deployResult: Result<void, JsmError>;

    if (mode === 'incremental' && 'deployIncremental' in pluginResult.value) {
      deployResult = await (pluginResult.value as any).deployIncremental(serverResult.value, deploymentResult.value);
    } else {
      deployResult = await pluginResult.value.deploy(serverResult.value, deploymentResult.value);
    }

    if (!deployResult.ok) return deployResult;

    await this.updateDeploymentState(serverId, deploymentId, 'synced');
    this.bus.emit('DeploymentStateChanged', { 
      srvId: serverId, 
      depId: deploymentId, 
      state: 'synced' 
    });
    
    return ok(undefined);
  }

  async undeploy(serverId: string, deploymentId: string): Promise<Result<void, JsmError>> {
    const serverResult = await this.getServerConfig(serverId);
    if (!serverResult.ok) return serverResult as any;

    // Detect server type from serverHome since type field was removed
    const typeResult = await this.pluginRegistry.detectServerType(serverResult.value.serverHome);
    if (!typeResult.ok) return typeResult as any;

    const pluginResult = this.pluginRegistry.get(typeResult.value);
    if (!pluginResult.ok) return pluginResult as any;

    const undeployResult = await pluginResult.value.undeploy(serverResult.value, deploymentId);
    if (!undeployResult.ok) return undeployResult;

    await this.updateDeploymentState(serverId, deploymentId, 'undeployed');
    
    const deploymentResult = await this.getDeployment(serverId, deploymentId);
    if (deploymentResult.ok) {
      this.bus.emit('DeploymentUndeployed', deploymentResult.value);
    }
    
    return ok(undefined);
  }

  /* ───────────────────── Query Operations ─────────────────── */

  async getDeployment(serverId: string, deploymentId: string): Promise<Result<DeploymentConfig, JsmError>> {
    const serverResult = await this.getServerConfig(serverId);
    if (!serverResult.ok) return serverResult as any;

    const deployment = serverResult.value.deployments?.find(d => d.id === deploymentId);
    if (!deployment) {
      return err(new JsmError(ErrorCode.DEPLOY_ERROR, `Deployment ${deploymentId} not found`));
    }

    return ok(deployment);
  }

  async listDeployments(serverId: string): Promise<Result<DeploymentConfig[], JsmError>> {
    const serverResult = await this.getServerConfig(serverId);
    if (!serverResult.ok) return serverResult as any;

    return ok(serverResult.value.deployments || []);
  }

  /* ───────────────────── Private Helpers ─────────────────── */

  private async validateDeployment(deployment: DeploymentConfig): Promise<Result<void, JsmError>> {
    // For now, use basic validation since deployments are part of server config validation
    // TODO: Extract deployment schema validation to SchemaValidator if needed
    try {
      // Basic validation
      if (!deployment.name || deployment.name.trim() === '') {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, 'Deployment name is required'));
      }
      
      if (!deployment.sourcePath || deployment.sourcePath.trim() === '') {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, 'Deployment source path is required'));
      }
      
      if (!deployment.type || (deployment.type !== 'war' && deployment.type !== 'exploded')) {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, 'Deployment type must be "war" or "exploded"'));
      }

      // Check if source is file or directory based on deployment type
      const sourceStat = await fs.promises.stat(deployment.sourcePath);
      if (deployment.type === 'war' && !sourceStat.isFile()) {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, `WAR deployment source must be a file: ${deployment.sourcePath}`));
      }
      if (deployment.type === 'exploded' && !sourceStat.isDirectory()) {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, `Exploded deployment source must be a directory: ${deployment.sourcePath}`));
      }

      return ok(undefined);
    } catch (error: any) {
      return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, `Deployment path validation failed: ${error.message || error}`, error));
    }
  }

  private async getServerConfig(serverId: string): Promise<Result<ServerConfig, JsmError>> {
    const serverResult = await this.configManager.getServer(serverId);
    if (!serverResult.ok) {
      return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, `Server ${serverId} not found`));
    }
    return serverResult;
  }

  private buildDeploymentConfig(draft: DeploymentConfig, server: ServerConfig): DeploymentConfig {
    return {
      ...draft,
      id: draft.id || `dep_${Date.now()}`,
      name: draft.name || this.extractNameFromPath(draft.sourcePath),
      type: draft.type || this.detectTypeFromPath(draft.sourcePath),
      state: 'undeployed',
      targetPath: draft.targetPath || this.generateTargetPath(draft, server)
    };
  }

  private extractNameFromPath(sourcePath: string): string {
    return sourcePath?.split('/').pop()?.replace('.war', '') || 'deployment';
  }

  private detectTypeFromPath(sourcePath: string): 'war' | 'exploded' {
    return sourcePath?.endsWith('.war') ? 'war' : 'exploded';
  }

  private generateTargetPath(draft: DeploymentConfig, server: ServerConfig): string {
    const effectivePath = (server as any).instancePath || server.serverHome;
    const webappsDir = `${effectivePath}/webapps`;
    const name = draft.renameTo || this.extractNameFromPath(draft.sourcePath);
    
    return draft.type === 'war' 
      ? `${webappsDir}/${name}.war` 
      : `${webappsDir}/${name}`;
  }

  private async updateDeploymentState(serverId: string, deploymentId: string, state: DeploymentConfig['state']): Promise<void> {
    const deploymentResult = await this.getDeployment(serverId, deploymentId);
    if (deploymentResult.ok) {
      const updatedDeployment = { ...deploymentResult.value, state };
      await this.configManager.updateDeployment(serverId, deploymentId, updatedDeployment);
    }
  }

  /* ───────────────────── Lifecycle ─────────────────── */

  dispose(): void {
    this.log.debug('DeploymentService disposed');
  }
}
/*
 * DeploymentService - Streamlined deployment orchestration following KISS principles
 * Single responsibility: Deploy, undeploy, and manage deployment lifecycle
 */

import { DeploymentConfig, ServerConfig, DeploymentRuntimeState, DeploymentRuntime, DeploymentState } from '../core/types/domain';
import { Result, ok, err } from '../core/utils/result';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { PluginRegistry } from '../core/server/plugins/index';
import { ConfigManager } from '../core/config/ConfigManager';
import { DeploymentStateRepo } from '../core/persistence/DeploymentStateRepo';
import { EventBus } from '../core/EventBus';
import { HookManager } from '../core/hooks/HookManager';
import { Logger } from '../core/utils/logger';
import { FileUtils } from '../core/utils/FileUtils';
import { SchemaValidator } from '../core/validation/SchemaValidator';
import * as fs from 'fs';
import * as path from 'path';

export class DeploymentService {
  private readonly log = Logger.getInstance().createChild('DeploymentService');
  private readonly schemaValidator = SchemaValidator.getInstance();
  private readonly stateRepo = DeploymentStateRepo.getInstance();

  constructor(
    private readonly configManager: ConfigManager,
    private readonly pluginRegistry: PluginRegistry,
    private readonly bus: EventBus,
    private readonly hooks: HookManager
  ) {}

  /**
   * Initialize deployment state repository
   */
  async initialize(workspaceUri: string): Promise<Result<void, JsmError>> {
    return await this.stateRepo.initialize(workspaceUri);
  }

  /**
   * Get deployment state
   */
  getDeploymentState(deploymentId: string): DeploymentState {
    const state = this.stateRepo.getState(deploymentId);
    return state?.state || 'undeployed';
  }

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

    // Initialize deployment runtime state
    await this.stateRepo.setState({
      deploymentId: deploymentConfig.id!,
      serverId,
      state: 'undeployed',
      lastUpdated: Date.now()
    });

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

    // Remove deployment runtime state
    await this.stateRepo.removeState(deploymentId);

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

    // Detect server type from homePath
    const typeResult = await this.pluginRegistry.detectServerType(serverResult.value.homePath);
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

    // Detect server type from homePath
    const typeResult = await this.pluginRegistry.detectServerType(serverResult.value.homePath);
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
    try {
      // Validate sourcePath (required field in JSM schema)
      if (!deployment.sourcePath || deployment.sourcePath.trim() === '') {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, 'Deployment source path is required'));
      }
      
      // Check if source path exists
      if (!(await FileUtils.fileExists(deployment.sourcePath))) {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, `Source path does not exist: ${deployment.sourcePath}`));
      }
      
      // Validate type if specified
      if (deployment.type && (deployment.type !== 'war' && deployment.type !== 'exploded')) {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, 'Deployment type must be "war" or "exploded"'));
      }

      // Check if source is file or directory based on deployment type
      const sourceStat = await fs.promises.stat(deployment.sourcePath);
      const detectedType = deployment.type || this.detectTypeFromPath(deployment.sourcePath);
      
      if (detectedType === 'war' && !sourceStat.isFile()) {
        return err(new JsmError(ErrorCode.SERVER_VALIDATION_ERROR, `WAR deployment source must be a file: ${deployment.sourcePath}`));
      }
      if (detectedType === 'exploded' && !sourceStat.isDirectory()) {
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
    // Build config following JSM schema structure
    const config: DeploymentConfig = {
      id: draft.id || `dep_${Date.now()}`,
      sourcePath: draft.sourcePath,
      deployName: draft.deployName || this.extractNameFromPath(draft.sourcePath),
      type: draft.type || this.detectTypeFromPath(draft.sourcePath),
      ignoreGlobs: draft.ignoreGlobs || ['**/.git/**', '**/node_modules/**', '**/.DS_Store']
    };
    
    return config;
  }

  private extractNameFromPath(sourcePath: string): string {
    return sourcePath?.split('/').pop()?.replace('.war', '') || 'deployment';
  }

  private detectTypeFromPath(sourcePath: string): 'war' | 'exploded' {
    return sourcePath?.endsWith('.war') ? 'war' : 'exploded';
  }

  /**
   * Generate target path in webapps directory
   */
  private generateTargetPath(deploymentConfig: DeploymentConfig, server: ServerConfig): string {
    const effectivePath = server.instancePath || server.homePath;
    const webappsDir = `${effectivePath}/webapps`;
    const deployName = deploymentConfig.deployName || this.extractNameFromPath(deploymentConfig.sourcePath);
    const type = deploymentConfig.type || this.detectTypeFromPath(deploymentConfig.sourcePath);
    
    return type === 'war' 
      ? `${webappsDir}/${deployName}.war` 
      : `${webappsDir}/${deployName}`;
  }

  /**
   * Generate context path for URL access
   */
  private generateContextPath(deploymentConfig: DeploymentConfig): string {
    const deployName = deploymentConfig.deployName || this.extractNameFromPath(deploymentConfig.sourcePath);
    return deployName === 'ROOT' ? '/' : `/${deployName}`;
  }

  /**
   * Update deployment runtime state
   */
  private async updateDeploymentState(serverId: string, deploymentId: string, state: string, error?: string): Promise<void> {
    await this.stateRepo.updateState(deploymentId, serverId, state, error);
  }

  /**
   * Get deployment runtime information combining config and state
   */
  async getDeploymentRuntime(serverId: string, deploymentId: string): Promise<Result<DeploymentRuntime, JsmError>> {
    const deploymentResult = await this.getDeployment(serverId, deploymentId);
    if (!deploymentResult.ok) return deploymentResult as any;

    const serverResult = await this.getServerConfig(serverId);
    if (!serverResult.ok) return serverResult as any;

    const config = deploymentResult.value;
    const state = this.stateRepo.getState(deploymentId) || {
      deploymentId,
      serverId,
      state: 'undeployed',
      lastUpdated: Date.now()
    };

    const runtime: DeploymentRuntime = {
      config,
      state,
      displayName: config.deployName || this.extractNameFromPath(config.sourcePath),
      targetPath: this.generateTargetPath(config, serverResult.value),
      contextPath: this.generateContextPath(config)
    };

    return ok(runtime);
  }

  /* ───────────────────── Lifecycle ─────────────────── */

  dispose(): void {
    this.log.debug('DeploymentService disposed');
  }
}
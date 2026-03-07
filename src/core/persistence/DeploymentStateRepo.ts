/*
 * src/core/persistence/DeploymentStateRepo.ts
 * Repository for deployment runtime state persistence
 * Stores deployment states separately from servers.json in extension storage
 */

import * as fs from 'fs';
import * as path from 'path';
import { DeploymentRuntimeState } from '../types/domain';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { FileUtils } from '../utils/FileUtils';
import { Logger } from '../utils/logger';

interface DeploymentStateFile {
  states: Record<string, DeploymentRuntimeState>; // key: deploymentId
}

/**
 * Repository for deployment runtime state persistence
 * Stores states in extension global storage organized by workspace
 */
export class DeploymentStateRepo {
  private static instance: DeploymentStateRepo | null = null;
  private readonly log = Logger.getInstance().createChild('DeploymentStateRepo');
  private stateFilePath: string = '';
  private cachedStates: Map<string, DeploymentRuntimeState> = new Map();

  private constructor() {}

  static getInstance(): DeploymentStateRepo {
    if (!DeploymentStateRepo.instance) {
      DeploymentStateRepo.instance = new DeploymentStateRepo();
    }
    return DeploymentStateRepo.instance;
  }

  /**
   * Initialize repository with workspace-specific storage path
   */
  async initialize(workspaceUri: string): Promise<Result<void, JsmError>> {
    try {
      const storageResult = FileUtils.getExtensionStoragePath();
      if (!storageResult.ok) {
        return storageResult as any;
      }

      // Create workspace-specific folder to avoid conflicts
      const workspaceHash = this.generateWorkspaceHash(workspaceUri);
      const deploymentStatesDir = path.join(storageResult.value, 'deployment-states', workspaceHash);
      
      const ensureDirResult = await FileUtils.ensureDirectory(deploymentStatesDir);
      if (!ensureDirResult.ok) {
        return ensureDirResult;
      }

      this.stateFilePath = path.join(deploymentStatesDir, 'deployment-states.json');
      
      const loadResult = await this.load();
      return loadResult.ok ? ok(undefined) : loadResult as any;
    } catch (error) {
      return err(new JsmError(
        ErrorCode.CONFIG_INVALID,
        `Failed to initialize deployment state repository: ${error instanceof Error ? error.message : 'Unknown error'}`
      ));
    }
  }

  /**
   * Load deployment states from storage
   */
  async load(): Promise<Result<DeploymentRuntimeState[], JsmError>> {
    try {
      if (!(await FileUtils.fileExists(this.stateFilePath))) {
        this.cachedStates.clear();
        return ok([]);
      }

      const content = await fs.promises.readFile(this.stateFilePath, 'utf8');
      const stateFile = JSON.parse(content) as DeploymentStateFile;
      
      this.cachedStates.clear();
      const states = Object.values(stateFile.states || {});
      states.forEach(state => {
        this.cachedStates.set(state.deploymentId, state);
      });
      
      this.log.debug(`Loaded ${states.length} deployment states`);
      return ok(states);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return err(new JsmError(ErrorCode.CONFIG_INVALID, `Invalid deployment state JSON: ${error.message}`));
      }
      return err(new JsmError(ErrorCode.FS_READ, `Failed to load deployment states: ${error}`));
    }
  }

  /**
   * Save deployment states to storage
   */
  async save(): Promise<Result<void, JsmError>> {
    try {
      const states: Record<string, DeploymentRuntimeState> = {};
      this.cachedStates.forEach((state, id) => {
        states[id] = state;
      });

      const stateFile: DeploymentStateFile = { states };
      const content = JSON.stringify(stateFile, null, 2);
      
      await fs.promises.writeFile(this.stateFilePath, content, 'utf8');
      this.log.debug(`Saved ${this.cachedStates.size} deployment states`);
      
      return ok(undefined);
    } catch (error) {
      return err(new JsmError(ErrorCode.FS_WRITE, `Failed to save deployment states: ${error}`));
    }
  }

  /**
   * Get state by deployment ID
   */
  getState(deploymentId: string): DeploymentRuntimeState | null {
    return this.cachedStates.get(deploymentId) || null;
  }

  /**
   * Get all states for a specific server
   */
  getStatesForServer(serverId: string): DeploymentRuntimeState[] {
    return Array.from(this.cachedStates.values()).filter(state => state.serverId === serverId);
  }

  /**
   * Set deployment state
   */
  async setState(state: DeploymentRuntimeState): Promise<Result<void, JsmError>> {
    state.lastUpdated = Date.now();
    this.cachedStates.set(state.deploymentId, state);
    return await this.save();
  }

  /**
   * Update deployment state
   */
  async updateState(
    deploymentId: string, 
    serverId: string, 
    newState: string, 
    error?: string
  ): Promise<Result<void, JsmError>> {
    const currentState = this.cachedStates.get(deploymentId);
    
    const updatedState: DeploymentRuntimeState = {
      deploymentId,
      serverId,
      state: newState as any,
      error,
      lastUpdated: Date.now()
    };

    this.cachedStates.set(deploymentId, updatedState);
    return await this.save();
  }

  /**
   * Remove state for a deployment
   */
  async removeState(deploymentId: string): Promise<Result<void, JsmError>> {
    this.cachedStates.delete(deploymentId);
    return await this.save();
  }

  /**
   * Remove all states for a server
   */
  async removeStatesForServer(serverId: string): Promise<Result<void, JsmError>> {
    const statesToRemove = Array.from(this.cachedStates.keys()).filter(
      id => this.cachedStates.get(id)?.serverId === serverId
    );
    
    statesToRemove.forEach(id => this.cachedStates.delete(id));
    return await this.save();
  }

  /**
   * Generate a hash for workspace URI to create unique storage folders
   */
  private generateWorkspaceHash(workspaceUri: string): string {
    // Simple hash function for workspace URI
    let hash = 0;
    for (let i = 0; i < workspaceUri.length; i++) {
      const char = workspaceUri.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}
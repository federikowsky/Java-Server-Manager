import type {
  ServerId,
  DeploymentId,
  ServerRuntimeState,
  DeploymentRuntimeState,
  KeyValueStore,
} from '@core/types';

const RUNTIME_KEY_PREFIX = 'runtime.server.';
const DEPLOY_KEY_PREFIX = 'runtime.deployment.';

function serverKey(serverId: ServerId): string {
  return `${RUNTIME_KEY_PREFIX}${serverId}`;
}

function deployKey(serverId: ServerId, deploymentId: DeploymentId): string {
  return `${DEPLOY_KEY_PREFIX}${serverId}.${deploymentId}`;
}

/**
 * Deployment/server runtime state persistence via KeyValueStore (§4.6).
 * Depends on the KeyValueStore interface — NOT directly on vscode.Memento.
 */
export class DeploymentStateRepo {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  // ── Server Runtime State ────────────────────────────────────────────────

  async getServerState(serverId: ServerId): Promise<ServerRuntimeState | undefined> {
    return this.store.get<ServerRuntimeState>(serverKey(serverId));
  }

  async setServerState(state: ServerRuntimeState): Promise<void> {
    await this.store.set(serverKey(state.serverId), state);
  }

  async clearServerState(serverId: ServerId): Promise<void> {
    await this.store.delete(serverKey(serverId));
  }

  // ── Deployment Runtime State ────────────────────────────────────────────

  async getDeploymentState(
    serverId: ServerId,
    deploymentId: DeploymentId,
  ): Promise<DeploymentRuntimeState | undefined> {
    return this.store.get<DeploymentRuntimeState>(deployKey(serverId, deploymentId));
  }

  async setDeploymentState(state: DeploymentRuntimeState): Promise<void> {
    await this.store.set(deployKey(state.serverId, state.deploymentId), state);
  }

  async clearDeploymentState(serverId: ServerId, deploymentId: DeploymentId): Promise<void> {
    await this.store.delete(deployKey(serverId, deploymentId));
  }
}

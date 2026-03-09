import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeploymentStateRepo } from '@infra/fs/DeploymentStateRepo';
import type { KeyValueStore, ServerRuntimeState, DeploymentRuntimeState } from '@core/types';

function mockStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn(<T>(key: string) => data.get(key) as T | undefined),
    set: vi.fn(async <T>(key: string, value: T) => { data.set(key, value); }),
    delete: vi.fn(async (key: string) => { data.delete(key); }),
  };
}

describe('DeploymentStateRepo', () => {
  let store: KeyValueStore;
  let repo: DeploymentStateRepo;

  beforeEach(() => {
    store = mockStore();
    repo = new DeploymentStateRepo(store);
  });

  it('stores and retrieves server runtime state', async () => {
    const state: ServerRuntimeState = {
      serverId: 's1',
      state: 'running',
      pid: 1234,
      lastTransitionAt: Date.now(),
    };
    await repo.setServerState(state);
    const retrieved = await repo.getServerState('s1');
    expect(retrieved).toEqual(state);
  });

  it('returns undefined for missing server state', async () => {
    const result = await repo.getServerState('missing');
    expect(result).toBeUndefined();
  });

  it('clears server state', async () => {
    const state: ServerRuntimeState = {
      serverId: 's1',
      state: 'stopped',
      lastTransitionAt: Date.now(),
    };
    await repo.setServerState(state);
    await repo.clearServerState('s1');
    const result = await repo.getServerState('s1');
    expect(result).toBeUndefined();
  });

  it('stores and retrieves deployment runtime state', async () => {
    const state: DeploymentRuntimeState = {
      serverId: 's1',
      deploymentId: 'd1',
      state: 'synced',
      lastSyncAt: Date.now(),
    };
    await repo.setDeploymentState(state);
    const retrieved = await repo.getDeploymentState('s1', 'd1');
    expect(retrieved).toEqual(state);
  });

  it('clears deployment state', async () => {
    const state: DeploymentRuntimeState = {
      serverId: 's1',
      deploymentId: 'd1',
      state: 'undeployed',
    };
    await repo.setDeploymentState(state);
    await repo.clearDeploymentState('s1', 'd1');
    const result = await repo.getDeploymentState('s1', 'd1');
    expect(result).toBeUndefined();
  });
});

/*
 * src/core/deployment/DeploymentManager.ts
 * Keeps in‑memory registry of deployments for one server and delegates
 * heavy‑lifting (publish / undeploy) to the given AbstractRuntime.
 */

import { DeploymentConfig } from '../types/domain';
import { AbstractRuntime } from '../server/AbstractRuntime';
import { Result, ok, err } from '../utils/result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Logger } from '../utils/logger';

export class DeploymentManager {
  private readonly log: ReturnType<typeof Logger['getInstance']>;
  private readonly map = new Map<string, DeploymentConfig>();

  constructor(private readonly serverId: string) {
    this.log = Logger.getInstance().createChild(`DeployMgr:${serverId}`);
  }

  /* ───────────────────── local CRUD ───────────────────── */
  add(draft: DeploymentConfig): Result<DeploymentConfig, JsmError> {
    if (this.map.has(draft.id)) {
      return err(new JsmError(ErrorCode.DEPLOY_ERROR, 'duplicate deployment id'));
    }
    this.map.set(draft.id, draft);
    return ok(draft);
  }

  get(depId: string): Result<DeploymentConfig, JsmError> {
    const d = this.map.get(depId);
    return d ? ok(d) : err(new JsmError(ErrorCode.UNDEPLOY_ERROR, 'deployment not found'));
  }

  remove(depId: string): Result<void, JsmError> {
    if (!this.map.delete(depId)) {
      return err(new JsmError(ErrorCode.UNDEPLOY_ERROR, 'deployment not found'));
    }
    return ok(undefined);
  }

  /* ───────────────────── runtime actions ───────────────────── */
  async publish(
    rt: AbstractRuntime,
    dep: DeploymentConfig,
    mode: 'incremental' | 'full'
  ): Promise<Result<void, JsmError>> {
    return await rt.publish(dep, mode);
  }

  async undeploy(
    rt: AbstractRuntime,
    dep: DeploymentConfig,
    soft: boolean
  ): Promise<Result<void, JsmError>> {
    return await rt.undeploy(dep, soft);
  }
}

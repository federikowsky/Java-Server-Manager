import type {
  ServerConfig,
  DeploymentConfig,
  ServerId,
  DeploymentId,
  DeploymentState,
  OperationContext,
  Logger,
  FileChangeBatch,
  TrustGate,
} from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { EventBus } from '@core/events/EventBus';
import type { IServerPlugin } from '@plugins/interfaces/IServerPlugin';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';


// ── Deployment Runtime State ────────────────────────────────────────────────

interface DeploymentEntry {
  serverId: ServerId;
  deploymentId: DeploymentId;
  state: DeploymentState;
  lastSyncAt?: number;
  lastError?: JsmError;
}

// ── Deployment State Transitions (§9.1.1) ───────────────────────────────────

const DEPLOY_TRANSITIONS: Record<DeploymentState, ReadonlySet<DeploymentState>> = {
  undeployed: new Set<DeploymentState>(['deploying']),
  deploying:  new Set<DeploymentState>(['synced', 'error', 'undeployed']),
  synced:     new Set<DeploymentState>(['deploying', 'undeployed']),
  error:      new Set<DeploymentState>(['deploying', 'undeployed']),
};

/**
 * Deployment orchestration service (§9.1.1, §10.2-§10.3).
 * Manages deploy/undeploy through plugin + DecisionEngine hints.
 */
export class DeploymentService {
  private readonly pluginRegistry: PluginRegistry;
  private readonly bus: EventBus;
  private readonly logger: Logger;
  private readonly trustGate?: TrustGate;
  private readonly states = new Map<string, DeploymentEntry>();

  constructor(deps: {
    pluginRegistry: PluginRegistry;
    bus: EventBus;
    logger: Logger;
    trustGate?: TrustGate;
  }) {
    this.pluginRegistry = deps.pluginRegistry;
    this.bus = deps.bus;
    this.logger = deps.logger;
    this.trustGate = deps.trustGate;
  }

  // ── State Management ──────────────────────────────────────────────

  private stateKey(serverId: ServerId, deploymentId: DeploymentId): string {
    return `${serverId}::${deploymentId}`;
  }

  getDeploymentState(serverId: ServerId, deploymentId: DeploymentId): DeploymentState {
    return this.states.get(this.stateKey(serverId, deploymentId))?.state ?? 'undeployed';
  }

  private transitionDeploy(
    serverId: ServerId,
    deploymentId: DeploymentId,
    to: DeploymentState,
    opts?: { error?: JsmError },
  ): void {
    const key = this.stateKey(serverId, deploymentId);
    const current = this.states.get(key)?.state ?? 'undeployed';

    if (!DEPLOY_TRANSITIONS[current].has(to)) {
      throw new JsmError({
        code: ErrorCode.OperationInProgress,
        message: `Invalid deployment transition: ${current} → ${to}`,
      });
    }

    this.states.set(key, {
      serverId,
      deploymentId,
      state: to,
      lastSyncAt: to === 'synced' ? Date.now() : this.states.get(key)?.lastSyncAt,
      lastError: opts?.error,
    });

    this.bus.emit('DeploymentStateChanged', { serverId, deploymentId, state: to });
  }

  // ── Full Redeploy ─────────────────────────────────────────────────

  async fullRedeploy(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<Result<void, JsmError>> {
    const trustCheck = this.checkTrust();
    if (!trustCheck.ok) return trustCheck;

    const plugin = this.getPlugin(config);

    this.transitionDeploy(ctx.serverId, dep.id, 'deploying');

    try {
      // Plan
      const planResult = await plugin.planDeploy(ctx, config, dep);
      if (!planResult.ok) {
        this.transitionDeploy(ctx.serverId, dep.id, 'error', { error: planResult.error });
        return planResult;
      }

      // Execute
      const deployResult = await plugin.deployFull(ctx, config, dep, planResult.value);
      if (!deployResult.ok) {
        this.transitionDeploy(ctx.serverId, dep.id, 'error', { error: deployResult.error });
        return deployResult;
      }

      this.transitionDeploy(ctx.serverId, dep.id, 'synced');
      this.logger.info(`DeploymentService: deployed ${dep.deployName} via ${deployResult.value.strategy}`);
      return ok(undefined);
    } catch (cause) {
      const error = cause instanceof JsmError ? cause : JsmError.fromUnknown(cause);
      this.transitionDeploy(ctx.serverId, dep.id, 'error', { error });
      return err(error);
    }
  }

  // ── Incremental Sync ──────────────────────────────────────────────

  async sync(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
    changes: FileChangeBatch,
  ): Promise<Result<void, JsmError>> {
    const trustCheck = this.checkTrust();
    if (!trustCheck.ok) return trustCheck;

    const plugin = this.getPlugin(config);

    if (!plugin.deployIncremental) {
      return this.fullRedeploy(ctx, config, dep);
    }

    this.transitionDeploy(ctx.serverId, dep.id, 'deploying');

    try {
      // Plan
      const planResult = await plugin.planDeploy(ctx, config, dep);
      if (!planResult.ok) {
        this.transitionDeploy(ctx.serverId, dep.id, 'error', { error: planResult.error });
        return planResult;
      }

      // Override plan strategy for incremental
      const incrementalPlan = { ...planResult.value, strategy: 'incremental-dir' as const };

      const result = await plugin.deployIncremental(ctx, config, dep, changes, incrementalPlan);
      if (!result.ok) {
        this.transitionDeploy(ctx.serverId, dep.id, 'error', { error: result.error });
        return result;
      }

      this.transitionDeploy(ctx.serverId, dep.id, 'synced');
      this.logger.debug(`DeploymentService: incremental sync for ${dep.deployName} (${changes.changes.length} files)`);
      return ok(undefined);
    } catch (cause) {
      const error = cause instanceof JsmError ? cause : JsmError.fromUnknown(cause);
      this.transitionDeploy(ctx.serverId, dep.id, 'error', { error });
      return err(error);
    }
  }

  // ── Undeploy ──────────────────────────────────────────────────────

  async undeploy(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<Result<void, JsmError>> {
    const trustCheck = this.checkTrust();
    if (!trustCheck.ok) return trustCheck;

    const plugin = this.getPlugin(config);
    const currentState = this.getDeploymentState(ctx.serverId, dep.id);

    // undeploy from error or synced → undeployed
    if (currentState !== 'undeployed') {
      try {
        const result = await plugin.undeploy(ctx, config, dep);
        if (!result.ok) return result;
      } catch (cause) {
        return err(cause instanceof JsmError ? cause : JsmError.fromUnknown(cause));
      }

      this.transitionDeploy(ctx.serverId, dep.id, 'undeployed');
    }

    return ok(undefined);
  }

  // ── Bulk Operations ───────────────────────────────────────────────

  async syncAll(
    ctx: OperationContext,
    config: ServerConfig,
    changesMap: Map<DeploymentId, FileChangeBatch>,
  ): Promise<void> {
    for (const dep of config.deployments) {
      const changes = changesMap.get(dep.id);
      if (changes) {
        await this.sync(ctx, config, dep, changes);
      } else {
        await this.fullRedeploy(ctx, config, dep);
      }
    }
  }

  async redeployAll(
    ctx: OperationContext,
    config: ServerConfig,
  ): Promise<void> {
    for (const dep of config.deployments) {
      await this.fullRedeploy(ctx, config, dep);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private getPlugin(config: ServerConfig): IServerPlugin {
    const plugin = this.pluginRegistry.get(config.type);
    if (!plugin) {
      throw new JsmError({
        code: ErrorCode.Unsupported,
        message: `No plugin found for server type '${config.type}'`,
      });
    }
    return plugin;
  }

  private checkTrust(): Result<void, JsmError> {
    if (this.trustGate && !this.trustGate.isTrusted()) {
      return err(new JsmError({
        code: ErrorCode.WorkspaceUntrusted,
        message: 'Grant workspace trust to manage deployments.',
      }));
    }
    return ok(undefined);
  }
}

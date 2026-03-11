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
  HookConfig,
  HookEvent,
} from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { EventBus } from '@core/events/EventBus';
import type { IServerPlugin } from '@plugins/interfaces/IServerPlugin';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { HookRunner } from '@app/hooks';


// ── Deployment Runtime State ────────────────────────────────────────────────

interface DeploymentEntry {
  serverId: ServerId;
  deploymentId: DeploymentId;
  state: DeploymentState;
  lastSyncAt?: number;
  lastError?: JsmError;
}

const SAFE_INCREMENTAL_EXTENSIONS = new Set([
  '.css',
  '.gif',
  '.htm',
  '.html',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.jsp',
  '.jspx',
  '.map',
  '.png',
  '.svg',
  '.txt',
  '.webp',
]);

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
  private readonly hookRunner?: Pick<HookRunner, 'runHooks'>;
  private readonly states = new Map<string, DeploymentEntry>();

  constructor(deps: {
    pluginRegistry: PluginRegistry;
    bus: EventBus;
    logger: Logger;
    trustGate?: TrustGate;
    hookRunner?: Pick<HookRunner, 'runHooks'>;
  }) {
    this.pluginRegistry = deps.pluginRegistry;
    this.bus = deps.bus;
    this.logger = deps.logger;
    this.trustGate = deps.trustGate;
    this.hookRunner = deps.hookRunner;
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
    return this.runDeploymentOperation(ctx, config, dep, 'deploy.full', async plugin => {
      const planResult = await plugin.planDeploy(ctx, config, dep);
      if (!planResult.ok) {
        return planResult;
      }

      const deployResult = await plugin.deployFull(ctx, config, dep, planResult.value);
      if (!deployResult.ok) {
        return deployResult;
      }

      this.logger.info(`DeploymentService: deployed ${dep.deployName} via ${deployResult.value.strategy}`);
      return ok(undefined);
    });
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

    if (!this.canUseIncrementalSync(dep, changes)) {
      this.logger.debug(`DeploymentService: falling back to redeploy for ${dep.deployName}`);
      return this.fullRedeploy(ctx, config, dep);
    }

    return this.runDeploymentOperation(ctx, config, dep, 'deploy.incremental', async () => {
      const planResult = await plugin.planDeploy(ctx, config, dep);
      if (!planResult.ok) {
        return planResult;
      }

      const incrementalPlan = { ...planResult.value, strategy: 'incremental-dir' as const };
      const result = await plugin.deployIncremental!(ctx, config, dep, changes, incrementalPlan);
      if (!result.ok) {
        return result;
      }

      this.logger.debug(`DeploymentService: incremental sync for ${dep.deployName} (${changes.changes.length} files)`);
      return ok(undefined);
    });
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
      await this.runDeploymentHooks(ctx.serverId, config, dep, 'pre', 'deploy.undeploy');

      try {
        const result = await plugin.undeploy(ctx, config, dep);
        if (!result.ok) {
          await this.runDeploymentOnErrorHooks(ctx.serverId, config, dep, 'deploy.undeploy');
          return result;
        }
      } catch (cause) {
        await this.runDeploymentOnErrorHooks(ctx.serverId, config, dep, 'deploy.undeploy');
        return err(cause instanceof JsmError ? cause : JsmError.fromUnknown(cause));
      }

      this.transitionDeploy(ctx.serverId, dep.id, 'undeployed');
      await this.runDeploymentHooks(ctx.serverId, config, dep, 'post', 'deploy.undeploy');
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

  /**
   * Deploys only deployments that are in 'undeployed' state (e.g. before first start).
   * Skips those already synced or in error. Throws on first deploy failure.
   */
  async deployUndeployed(
    ctx: OperationContext,
    config: ServerConfig,
  ): Promise<void> {
    const undeployed = config.deployments.filter(
      dep => this.getDeploymentState(ctx.serverId, dep.id) === 'undeployed',
    );
    for (const dep of undeployed) {
      const deployCtx: OperationContext = {
        ...ctx,
        kind: 'DeployFull',
        targetDeploymentId: dep.id,
      };
      const result = await this.fullRedeploy(deployCtx, config, dep);
      if (!result.ok) throw result.error;
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

  private canUseIncrementalSync(dep: DeploymentConfig, changes: FileChangeBatch): boolean {
    if (dep.type !== 'exploded') {
      return false;
    }

    return changes.changes.every(change => this.isSafeIncrementalPath(change.relativePath));
  }

  private isSafeIncrementalPath(relativePath: string): boolean {
    const normalizedPath = relativePath.replace(/\\/g, '/').toLowerCase();

    if (
      normalizedPath.startsWith('web-inf/')
      || normalizedPath.startsWith('meta-inf/')
    ) {
      return false;
    }

    const fileName = normalizedPath.split('/').pop() ?? '';
    const extensionIndex = fileName.lastIndexOf('.');
    const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex) : '';
    return SAFE_INCREMENTAL_EXTENSIONS.has(extension);
  }

  private async runDeploymentOperation(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
    event: HookEvent,
    operation: (plugin: IServerPlugin) => Promise<Result<void, JsmError>>,
  ): Promise<Result<void, JsmError>> {
    const trustCheck = this.checkTrust();
    if (!trustCheck.ok) return trustCheck;

    const plugin = this.getPlugin(config);
    this.transitionDeploy(ctx.serverId, dep.id, 'deploying');

    try {
      await this.runDeploymentHooks(ctx.serverId, config, dep, 'pre', event);
      const result = await operation(plugin);
      if (!result.ok) {
        await this.runDeploymentOnErrorHooks(ctx.serverId, config, dep, event);
        this.transitionDeploy(ctx.serverId, dep.id, 'error', { error: result.error });
        return result;
      }

      this.transitionDeploy(ctx.serverId, dep.id, 'synced');
      await this.runDeploymentHooks(ctx.serverId, config, dep, 'post', event);
      return ok(undefined);
    } catch (cause) {
      const error = cause instanceof JsmError ? cause : JsmError.fromUnknown(cause);
      await this.runDeploymentOnErrorHooks(ctx.serverId, config, dep, event);
      this.transitionDeploy(ctx.serverId, dep.id, 'error', { error });
      return err(error);
    }
  }

  private mergedHooks(config: ServerConfig, dep: DeploymentConfig): HookConfig[] {
    return [...config.hooks, ...dep.hooks];
  }

  private async runDeploymentHooks(
    serverId: ServerId,
    config: ServerConfig,
    dep: DeploymentConfig,
    phase: 'pre' | 'post' | 'onError',
    event: HookEvent,
  ): Promise<void> {
    if (!this.hookRunner) return;
    const result = await this.hookRunner.runHooks(serverId, phase, event, this.mergedHooks(config, dep));
    if (!result.ok) {
      throw result.error;
    }
  }

  private async runDeploymentOnErrorHooks(
    serverId: ServerId,
    config: ServerConfig,
    dep: DeploymentConfig,
    event: HookEvent,
  ): Promise<void> {
    if (!this.hookRunner) return;
    const result = await this.hookRunner.runHooks(serverId, 'onError', event, this.mergedHooks(config, dep));
    if (!result.ok) {
      this.logger.warn(`DeploymentService: onError hook failed for '${dep.deployName}'`, result.error);
    }
  }
}

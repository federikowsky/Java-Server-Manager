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
import { throwIfCancelled } from '@core/ops';
import type { HealthReport } from '@plugins/interfaces/IServerPlugin';
import type { IServerPlugin } from '@plugins/interfaces/IServerPlugin';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { HookRunner } from '@app/hooks';

const DEPLOYMENT_HEALTH_TIMEOUT_MS = 5000;


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

// ── Hot Reload Helpers ──────────────────────────────────────────────────────

/**
 * Check if a path is safe for hot-reload (excludes WEB-INF/ and META-INF/).
 * Users can use ignoreGlobs to exclude specific files.
 */
function isSafeHotReloadPath(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/').toLowerCase();
  return !normalizedPath.startsWith('web-inf/') && !normalizedPath.startsWith('meta-inf/');
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
  private readonly hookRunner?: Pick<HookRunner, 'runHooks'>;
  private readonly states = new Map<string, DeploymentEntry>();
  private readonly healthCache = new Map<string, HealthReport>();

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

  /** Last deployment health result (for tree tooltip). */
  getDeploymentHealth(serverId: ServerId, deploymentId: DeploymentId): HealthReport | undefined {
    return this.healthCache.get(this.stateKey(serverId, deploymentId));
  }

  /** Run health GET for all synced deployments with healthCheckPath; results stored for tooltip. */
  async runHealthChecksForServer(serverKey: ServerId, config: ServerConfig): Promise<void> {
    const { host, ports } = config;
    for (const dep of config.deployments) {
      if (!dep.healthCheckPath?.trim()) continue;
      if (this.getDeploymentState(serverKey, dep.id) !== 'synced') continue;
      const path = dep.healthCheckPath.trim().startsWith('/') ? dep.healthCheckPath.trim() : `/${dep.healthCheckPath.trim()}`;
      const url = `http://${host}:${ports.http}${path}`;
      const timeoutMs = dep.healthCheckTimeoutMs ?? DEPLOYMENT_HEALTH_TIMEOUT_MS;
      const result = await this.fetchHealth(url, timeoutMs);
      this.healthCache.set(this.stateKey(serverKey, dep.id), result.ok ? result.value : { ok: false });
    }
  }

  private async fetchHealth(url: string, timeoutMs: number): Promise<Result<HealthReport, JsmError>> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      const latencyMs = Date.now() - startedAt;
      clearTimeout(timeoutId);
      const healthy = response.ok && response.status >= 200 && response.status < 300;
      return ok({ ok: healthy, latencyMs });
    } catch (cause) {
      clearTimeout(timeoutId);
      if (cause instanceof Error && cause.name === 'AbortError') {
        return err(new JsmError({ code: ErrorCode.Timeout, message: 'Health check timed out', details: url, cause }));
      }
      return err(JsmError.fromUnknown(cause, ErrorCode.ValidationFailed));
    }
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

  // ── Rollback ──────────────────────────────────────────────────────

  async rollback(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
  ): Promise<Result<void, JsmError>> {
    const trustCheck = this.checkTrust();
    if (!trustCheck.ok) return trustCheck;

    this.ensureNotCancelled(ctx, dep, 'before rollback.');
    const plugin = this.getPlugin(config);
    if (!plugin.rollbackDeploy) {
      return err(new JsmError({
        code: ErrorCode.Unsupported,
        message: `Deployment rollback is not supported for server type '${config.type}'.`,
      }));
    }

    this.transitionDeploy(ctx.serverId, dep.id, 'deploying');
    try {
      const planResult = await plugin.planDeploy(ctx, config, dep);
      if (!planResult.ok) {
        this.transitionDeploy(ctx.serverId, dep.id, 'error', { error: planResult.error });
        return planResult;
      }

      this.ensureNotCancelled(ctx, dep, 'before executing rollback.');
      const rollbackResult = await plugin.rollbackDeploy(ctx, config, dep, planResult.value);
      if (!rollbackResult.ok) {
        this.transitionDeploy(ctx.serverId, dep.id, 'error', { error: rollbackResult.error });
        return rollbackResult;
      }

      this.transitionDeploy(ctx.serverId, dep.id, 'synced');
      this.logger.info(`DeploymentService: rolled back ${dep.deployName} via ${rollbackResult.value.strategy}`);
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
    const currentState = this.getDeploymentState(ctx.serverId, dep.id);

    // ── Hot Reload Path ─────────────────────────────────────────────
    // Attempt hot-reload if: flag enabled, plugin supports, state allows, changes are safe
    if (dep.hotReload && plugin.getCapabilities().supportsHotReload && plugin.hotReload) {
      if (currentState !== 'synced' && currentState !== 'undeployed') {
        this.logger.debug(`Cannot hot-reload '${dep.deployName}' in state '${currentState}', falling back`);
      } else if (!this.canUseHotReload(dep, changes)) {
        this.logger.debug(`Changes not eligible for hot-reload for '${dep.deployName}' (WEB-INF/META-INF)`);
      } else {
        // Attempt hot-reload
        const hotReloadCtx: OperationContext = { ...ctx, kind: 'DeployHotReload' };
        const result = await this.runDeploymentOperation(hotReloadCtx, config, dep, 'deploy.incremental', async () => {
          const planResult = await plugin.planDeploy(hotReloadCtx, config, dep);
          if (!planResult.ok) return planResult;

          const hotReloadPlan = { ...planResult.value, strategy: 'incremental-dir' as const };
          const hotReloadResult = await plugin.hotReload!(hotReloadCtx, config, dep, changes, hotReloadPlan);
          return hotReloadResult;
        });

        if (result.ok) {
          this.logger.info(`Hot-reload succeeded for '${dep.deployName}'`);
          return ok(undefined);
        }
        this.logger.warn(`Hot-reload failed for '${dep.deployName}', falling back: ${result.error.message}`);
        // Fall through to incremental/full deploy
      }
    }

    // ── Incremental Deploy Path ─────────────────────────────────────
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
      this.ensureNotCancelled(ctx, dep, 'before undeploy.');
      await this.runDeploymentHooks(ctx, config, dep, 'pre', 'deploy.undeploy');
      this.ensureNotCancelled(ctx, dep, 'before executing undeploy.');

      try {
        const result = await plugin.undeploy(ctx, config, dep);
        if (!result.ok) {
          await this.runDeploymentOnErrorHooks(ctx, config, dep, 'deploy.undeploy');
          return result;
        }
      } catch (cause) {
        await this.runDeploymentOnErrorHooks(ctx, config, dep, 'deploy.undeploy');
        return err(cause instanceof JsmError ? cause : JsmError.fromUnknown(cause));
      }

      this.transitionDeploy(ctx.serverId, dep.id, 'undeployed');
      await this.runDeploymentHooks(ctx, config, dep, 'post', 'deploy.undeploy');
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
      this.ensureNotCancelled(ctx, dep, 'before syncing the next deployment.');
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
      this.ensureNotCancelled(ctx, dep, 'before redeploying the next deployment.');
      this.recoverStaleDeployingState(ctx.serverId, dep, 'RedeployAll');
      const result = await this.fullRedeploy(ctx, config, dep);
      if (!result.ok) {
        throw result.error;
      }
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
    for (const dep of config.deployments) {
      this.ensureNotCancelled(ctx, dep, 'before deploying the next undeployed application.');
      this.recoverStaleDeployingState(ctx.serverId, dep, 'DeployUndeployed');
      if (this.getDeploymentState(ctx.serverId, dep.id) !== 'undeployed') {
        continue;
      }
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

  /**
   * Check if changes are eligible for hot-reload.
   * Only exploded deployments with hotReload flag enabled.
   * Excludes WEB-INF/ and META-INF/ paths (no extension whitelist).
   */
  private canUseHotReload(dep: DeploymentConfig, changes: FileChangeBatch): boolean {
    if (dep.type !== 'exploded' || !dep.hotReload) {
      return false;
    }
    return changes.changes.every(change => isSafeHotReloadPath(change.relativePath));
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

    this.ensureNotCancelled(ctx, dep, `before ${event}.`);
    const plugin = this.getPlugin(config);
    this.transitionDeploy(ctx.serverId, dep.id, 'deploying');

    try {
      await this.runDeploymentHooks(ctx, config, dep, 'pre', event);
      this.ensureNotCancelled(ctx, dep, `before executing ${event}.`);
      const result = await operation(plugin);
      if (!result.ok) {
        await this.runDeploymentOnErrorHooks(ctx, config, dep, event);
        this.transitionDeploy(ctx.serverId, dep.id, 'error', { error: result.error });
        return result;
      }

      this.transitionDeploy(ctx.serverId, dep.id, 'synced');
      await this.runDeploymentHooks(ctx, config, dep, 'post', event);
      return ok(undefined);
    } catch (cause) {
      const error = cause instanceof JsmError ? cause : JsmError.fromUnknown(cause);
      await this.runDeploymentOnErrorHooks(ctx, config, dep, event);
      this.transitionDeploy(ctx.serverId, dep.id, 'error', { error });
      return err(error);
    }
  }

  private ensureNotCancelled(
    ctx: OperationContext,
    dep: DeploymentConfig,
    stage: string,
  ): void {
    throwIfCancelled(
      ctx.cancel,
      `Deployment operation '${ctx.kind}' for '${dep.deployName}' was cancelled ${stage}`,
    );
  }

  private recoverStaleDeployingState(
    serverId: ServerId,
    dep: DeploymentConfig,
    operationName: 'RedeployAll' | 'DeployUndeployed',
  ): void {
    if (this.getDeploymentState(serverId, dep.id) !== 'deploying') {
      return;
    }

    const error = new JsmError({
      code: ErrorCode.DeployFailed,
      message: `Recovered stale deploying state for '${dep.deployName}' before ${operationName}.`,
    });
    this.logger.warn(`DeploymentService: ${error.message}`);
    this.transitionDeploy(serverId, dep.id, 'error', { error });
  }

  private mergedHooks(config: ServerConfig, dep: DeploymentConfig): HookConfig[] {
    return [...config.hooks, ...dep.hooks];
  }

  private async runDeploymentHooks(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
    phase: 'pre' | 'post' | 'onError',
    event: HookEvent,
  ): Promise<void> {
    if (!this.hookRunner) return;
    const result = await this.hookRunner.runHooks({
      parent: ctx,
      phase,
      event,
      hooks: this.mergedHooks(config, dep),
      targetDeploymentId: dep.id,
    });
    if (!result.ok) {
      throw result.error;
    }
  }

  private async runDeploymentOnErrorHooks(
    ctx: OperationContext,
    config: ServerConfig,
    dep: DeploymentConfig,
    event: HookEvent,
  ): Promise<void> {
    if (!this.hookRunner) return;
    const result = await this.hookRunner.runHooks({
      parent: ctx,
      phase: 'onError',
      event,
      hooks: this.mergedHooks(config, dep),
      targetDeploymentId: dep.id,
    });
    if (!result.ok) {
      this.logger.warn(`DeploymentService: onError hook failed for '${dep.deployName}'`, result.error);
    }
  }
}

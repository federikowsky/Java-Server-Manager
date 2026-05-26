import type {
  ServerConfig,
  ServerId,
  DeploymentId,
  OperationContext,
  Logger,
  OutputSink,
} from '@core/types';
import type { FileChangeBatch } from '@core/types/events';
import type { Result } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { throwIfCancelled } from '@core/ops';
import { QUEUE_META_FILE_CHANGE_BATCH } from '@core/ops/OperationQueue';
import type { QueueEntry } from '@core/ops/OperationQueue';
import type { DeploymentService } from '@app/deployment/DeploymentService';
import { makeCtx } from './serverLifecycleHelpers';

export interface ServerLifecycleDeployDeps {
  deployService: Pick<
    DeploymentService,
    'deployUndeployed' | 'fullRedeploy' | 'redeployAll' | 'rollback' | 'runHealthChecksForServer' | 'sync' | 'undeploy'
  >;
  logger: Logger;
  getOutputSink?: (serverKey: ServerId, serverName: string) => OutputSink;
  resolveServerConfig?: (serverKey: ServerId) => ServerConfig | undefined;
  environmentProfiles?: {
    resolveForServer(config: ServerConfig): Promise<Result<ServerConfig, JsmError>>;
  };
  onDeploySyncFailure?: (serverKey: ServerId, deploymentId: DeploymentId) => void;
}

export interface ServerLifecycleDeployEntry {
  serverKey: ServerId;
  config: ServerConfig;
}

interface TargetedDeploymentOperationContext {
  config: ServerConfig;
  deploymentId: DeploymentId;
  deployment: ServerConfig['deployments'][number];
  ctx: OperationContext;
}

function appendDeploySyncFailure(
  ctx: OperationContext,
  deployName: string,
  error: JsmError,
): void {
  ctx.output.appendLine(`Deploy sync failed for '${deployName}': ${error.message}`);
}

async function resolveRunningConfig(
  deps: Pick<ServerLifecycleDeployDeps, 'resolveServerConfig' | 'environmentProfiles'>,
  server: ServerLifecycleDeployEntry,
): Promise<ServerConfig> {
  const config = deps.resolveServerConfig?.(server.serverKey) ?? server.config;
  const result = await deps.environmentProfiles?.resolveForServer(config);
  if (!result) {
    return config;
  }
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

function resolveTargetDeployment(
  config: ServerConfig,
  deploymentId: DeploymentId,
): ServerConfig['deployments'][number] {
  const dep = config.deployments.find(candidate => candidate.id === deploymentId);
  if (!dep) {
    throw new JsmError({
      code: ErrorCode.InvalidConfig,
      message: `Deployment '${deploymentId}' not found`,
    });
  }
  return dep;
}

function makeDeployCtx(
  deps: Pick<ServerLifecycleDeployDeps, 'getOutputSink'>,
  server: ServerLifecycleDeployEntry,
  config: ServerConfig,
  kind: OperationContext['kind'],
  timeoutMs: number,
  cancel: OperationContext['cancel'],
  operationId: OperationContext['operationId'],
): OperationContext {
  return makeCtx(
    server.serverKey,
    kind,
    timeoutMs,
    cancel,
    deps.getOutputSink?.(server.serverKey, config.name),
    operationId,
  );
}

function requireTargetDeploymentId(entry: QueueEntry, operationName: string): DeploymentId {
  const deploymentId = entry.targetDeploymentId;
  if (deploymentId) {
    return deploymentId;
  }

  throw new JsmError({
    code: ErrorCode.InvalidConfig,
    message: `${operationName} requires targetDeploymentId`,
  });
}

async function createTargetedDeploymentOperationContext(
  deps: Pick<ServerLifecycleDeployDeps, 'getOutputSink' | 'resolveServerConfig' | 'environmentProfiles'>,
  server: ServerLifecycleDeployEntry,
  options: {
    deploymentId: DeploymentId;
    kind: OperationContext['kind'];
    timeoutMs: number;
    cancel: OperationContext['cancel'];
    operationId: OperationContext['operationId'];
  },
): Promise<TargetedDeploymentOperationContext> {
  const config = await resolveRunningConfig(deps, server);
  const deployment = resolveTargetDeployment(config, options.deploymentId);
  const ctx = makeDeployCtx(
    deps,
    server,
    config,
    options.kind,
    options.timeoutMs,
    options.cancel,
    options.operationId,
  );
  ctx.targetDeploymentId = options.deploymentId;

  return {
    config,
    deploymentId: options.deploymentId,
    deployment,
    ctx,
  };
}

async function runTargetedDeploymentOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  entry: QueueEntry,
  options: {
    kind: 'DeployFull' | 'DeployRollback' | 'Undeploy';
    timeoutMs: number;
    operationId: OperationContext['operationId'];
    cancel: OperationContext['cancel'];
    run: (
      ctx: OperationContext,
      config: ServerConfig,
      deployment: ServerConfig['deployments'][number],
    ) => Promise<Result<void, JsmError>>;
  },
): Promise<void> {
  const deploymentId = requireTargetDeploymentId(entry, options.kind);
  const context = await createTargetedDeploymentOperationContext(deps, server, {
    deploymentId,
    kind: options.kind,
    timeoutMs: options.timeoutMs,
    cancel: options.cancel,
    operationId: options.operationId,
  });
  const result = await options.run(context.ctx, context.config, context.deployment);
  if (!result.ok) {
    throw result.error;
  }
}

function resolveDeploySyncBatch(entry: QueueEntry): FileChangeBatch | undefined {
  const batch = entry.meta?.[QUEUE_META_FILE_CHANGE_BATCH];
  return batch && typeof batch === 'object' && Array.isArray((batch as FileChangeBatch).changes)
    ? batch as FileChangeBatch
    : undefined;
}

function requireDeploySyncBatch(entry: QueueEntry): FileChangeBatch {
  const batch = resolveDeploySyncBatch(entry);
  if (batch) {
    return batch;
  }

  throw new JsmError({
    code: ErrorCode.InvalidConfig,
    message: 'DeploySync requires fileChangeBatch metadata',
  });
}

export async function runDeployFullOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  entry: QueueEntry,
  operationId: OperationContext['operationId'],
  cancel: OperationContext['cancel'],
): Promise<void> {
  await runTargetedDeploymentOperation(deps, server, entry, {
    kind: 'DeployFull',
    timeoutMs: 600_000,
    operationId,
    cancel,
    run: (ctx, config, deployment) => deps.deployService.fullRedeploy(ctx, config, deployment),
  });
}

export async function runDeploymentRollbackOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  entry: QueueEntry,
  operationId: OperationContext['operationId'],
  cancel: OperationContext['cancel'],
): Promise<void> {
  await runTargetedDeploymentOperation(deps, server, entry, {
    kind: 'DeployRollback',
    timeoutMs: 600_000,
    operationId,
    cancel,
    run: (ctx, config, deployment) => deps.deployService.rollback(ctx, config, deployment),
  });
}

export async function runUndeployOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  entry: QueueEntry,
  operationId: OperationContext['operationId'],
  cancel: OperationContext['cancel'],
): Promise<void> {
  await runTargetedDeploymentOperation(deps, server, entry, {
    kind: 'Undeploy',
    timeoutMs: 600_000,
    operationId,
    cancel,
    run: (ctx, config, deployment) => deps.deployService.undeploy(ctx, config, deployment),
  });
}

export async function runRedeployAllOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  operationId: OperationContext['operationId'],
  cancel: OperationContext['cancel'],
): Promise<void> {
  const config = await resolveRunningConfig(deps, server);
  const ctx = makeDeployCtx(deps, server, config, 'RedeployAll', 600_000, cancel, operationId);
  await deps.deployService.redeployAll(ctx, config);
}

export async function runDeployUndeployedOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  operationId: OperationContext['operationId'],
  cancel: OperationContext['cancel'],
): Promise<void> {
  const config = await resolveRunningConfig(deps, server);
  const ctx = makeDeployCtx(deps, server, config, 'DeployUndeployed', 600_000, cancel, operationId);
  await deps.deployService.deployUndeployed(ctx, config);
}

export async function runDeploymentHealthChecksOperation(
  deps: Pick<ServerLifecycleDeployDeps, 'deployService' | 'resolveServerConfig' | 'environmentProfiles'>,
  server: ServerLifecycleDeployEntry,
  cancel: OperationContext['cancel'],
): Promise<void> {
  throwIfCancelled(cancel, 'Deployment health checks cancelled.');
  const config = await resolveRunningConfig(deps, server);
  await deps.deployService.runHealthChecksForServer(server.serverKey, config);
}

export async function runDeploySyncOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  entry: QueueEntry,
  operationId: OperationContext['operationId'],
  cancel: OperationContext['cancel'],
): Promise<void> {
  const deploymentId = requireTargetDeploymentId(entry, 'DeploySync');
  const batch = requireDeploySyncBatch(entry);

  let context: TargetedDeploymentOperationContext;
  try {
    context = await createTargetedDeploymentOperationContext(deps, server, {
      deploymentId,
      kind: 'DeploySync',
      timeoutMs: 30_000,
      cancel,
      operationId,
    });
  } catch (error) {
    if (error instanceof JsmError && error.code === ErrorCode.InvalidConfig) {
      deps.logger.warn(`ServerLifecycle: DeploySync deployment '${deploymentId}' not found`);
      return;
    }
    throw error;
  }

  let result: Result<void, JsmError>;
  try {
    result = await deps.deployService.sync(
      context.ctx,
      context.config,
      context.deployment,
      batch,
    );
  } catch (cause) {
    const error = cause instanceof JsmError ? cause : JsmError.fromUnknown(cause);
    appendDeploySyncFailure(context.ctx, context.deployment.deployName, error);
    deps.onDeploySyncFailure?.(server.serverKey, deploymentId);
    throw error;
  }

  if (!result.ok) {
    appendDeploySyncFailure(context.ctx, context.deployment.deployName, result.error);
    deps.onDeploySyncFailure?.(server.serverKey, deploymentId);
    throw result.error;
  }
}

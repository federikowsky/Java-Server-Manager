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
    'deployUndeployed' | 'fullRedeploy' | 'redeployAll' | 'runHealthChecksForServer' | 'sync' | 'undeploy'
  >;
  logger: Logger;
  getOutputSink?: (serverKey: ServerId, serverName: string) => OutputSink;
  resolveServerConfig?: (serverKey: ServerId) => ServerConfig | undefined;
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

function resolveRunningConfig(
  deps: Pick<ServerLifecycleDeployDeps, 'resolveServerConfig'>,
  server: ServerLifecycleDeployEntry,
): ServerConfig {
  return deps.resolveServerConfig?.(server.serverKey) ?? server.config;
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

function createTargetedDeploymentOperationContext(
  deps: Pick<ServerLifecycleDeployDeps, 'getOutputSink' | 'resolveServerConfig'>,
  server: ServerLifecycleDeployEntry,
  options: {
    deploymentId: DeploymentId;
    kind: OperationContext['kind'];
    timeoutMs: number;
    cancel: OperationContext['cancel'];
    operationId: OperationContext['operationId'];
  },
): TargetedDeploymentOperationContext {
  const config = resolveRunningConfig(deps, server);
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
    kind: 'DeployFull' | 'Undeploy';
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
  const context = createTargetedDeploymentOperationContext(deps, server, {
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
  const config = resolveRunningConfig(deps, server);
  const ctx = makeDeployCtx(deps, server, config, 'RedeployAll', 600_000, cancel, operationId);
  await deps.deployService.redeployAll(ctx, config);
}

export async function runDeployUndeployedOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  operationId: OperationContext['operationId'],
  cancel: OperationContext['cancel'],
): Promise<void> {
  const config = resolveRunningConfig(deps, server);
  const ctx = makeDeployCtx(deps, server, config, 'DeployUndeployed', 600_000, cancel, operationId);
  await deps.deployService.deployUndeployed(ctx, config);
}

export async function runDeploymentHealthChecksOperation(
  deps: Pick<ServerLifecycleDeployDeps, 'deployService' | 'resolveServerConfig'>,
  server: ServerLifecycleDeployEntry,
  cancel: OperationContext['cancel'],
): Promise<void> {
  throwIfCancelled(cancel, 'Deployment health checks cancelled.');
  const config = resolveRunningConfig(deps, server);
  await deps.deployService.runHealthChecksForServer(server.serverKey, config);
}

export async function runDeploySyncOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  entry: QueueEntry,
  operationId: OperationContext['operationId'],
  cancel: OperationContext['cancel'],
): Promise<void> {
  const deploymentId = entry.targetDeploymentId;
  if (!deploymentId) {
    deps.logger.warn('ServerLifecycle: DeploySync missing targetDeploymentId');
    return;
  }

  const batch = resolveDeploySyncBatch(entry);
  if (!batch) {
    deps.logger.warn('ServerLifecycle: DeploySync missing fileChangeBatch meta');
    return;
  }

  let context: TargetedDeploymentOperationContext;
  try {
    context = createTargetedDeploymentOperationContext(deps, server, {
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
    deps.onDeploySyncFailure?.(server.serverKey, deploymentId);
    throw cause;
  }

  if (!result.ok) {
    deps.onDeploySyncFailure?.(server.serverKey, deploymentId);
    throw result.error;
  }
}

import type {
  ServerConfig,
  ServerId,
  DeploymentId,
  OperationContext,
  Logger,
  OutputSink,
} from '@core/types';
import type { FileChangeBatch } from '@core/types/events';
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

export async function runDeployFullOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  entry: QueueEntry,
  operationId: OperationContext['operationId'],
  cancel: OperationContext['cancel'],
): Promise<void> {
  const deploymentId = entry.targetDeploymentId;
  if (!deploymentId) {
    throw new JsmError({
      code: ErrorCode.InvalidConfig,
      message: 'DeployFull requires targetDeploymentId',
    });
  }

  const config = resolveRunningConfig(deps, server);
  const dep = resolveTargetDeployment(config, deploymentId);
  const ctx = makeDeployCtx(deps, server, config, 'DeployFull', 600_000, cancel, operationId);
  ctx.targetDeploymentId = deploymentId;

  const result = await deps.deployService.fullRedeploy(ctx, config, dep);
  if (!result.ok) {
    throw result.error;
  }
}

export async function runUndeployOperation(
  deps: ServerLifecycleDeployDeps,
  server: ServerLifecycleDeployEntry,
  entry: QueueEntry,
  operationId: OperationContext['operationId'],
  cancel: OperationContext['cancel'],
): Promise<void> {
  const deploymentId = entry.targetDeploymentId;
  if (!deploymentId) {
    throw new JsmError({
      code: ErrorCode.InvalidConfig,
      message: 'Undeploy requires targetDeploymentId',
    });
  }

  const config = resolveRunningConfig(deps, server);
  const dep = resolveTargetDeployment(config, deploymentId);
  const ctx = makeDeployCtx(deps, server, config, 'Undeploy', 600_000, cancel, operationId);
  ctx.targetDeploymentId = deploymentId;

  const result = await deps.deployService.undeploy(ctx, config, dep);
  if (!result.ok) {
    throw result.error;
  }
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

  const batch = entry.meta?.[QUEUE_META_FILE_CHANGE_BATCH] as FileChangeBatch | undefined;
  if (!batch || !Array.isArray(batch.changes)) {
    deps.logger.warn('ServerLifecycle: DeploySync missing fileChangeBatch meta');
    return;
  }

  const config = resolveRunningConfig(deps, server);
  const dep = config.deployments.find(candidate => candidate.id === deploymentId);
  if (!dep) {
    deps.logger.warn(`ServerLifecycle: DeploySync deployment '${deploymentId}' not found`);
    return;
  }

  const ctx = makeDeployCtx(deps, server, config, 'DeploySync', 30_000, cancel, operationId);
  ctx.targetDeploymentId = deploymentId;

  try {
    const result = await deps.deployService.sync(ctx, config, dep, batch);
    if (!result.ok) {
      deps.onDeploySyncFailure?.(server.serverKey, deploymentId);
    }
  } catch (cause) {
    deps.onDeploySyncFailure?.(server.serverKey, deploymentId);
    throw cause;
  }
}

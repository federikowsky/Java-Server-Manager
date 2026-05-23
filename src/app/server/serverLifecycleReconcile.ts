import type { ServerConfig, ServerId, Logger, StartMode } from '@core/types';
import type { EventBus } from '@core/events/EventBus';
import type { PidManager, PidRecord } from '@infra/pid';
import { RECONCILIATION_BUDGET_MS } from '../../constants';
import { sleep } from './serverLifecycleHelpers';
import * as path from 'path';

export interface ServerLifecycleReconcileEntry {
  runtime: {
    state: string;
    lastStartMode: StartMode | undefined;
    forceState: (state: 'running' | 'stopped', opts?: { pid?: number; startMode?: StartMode }) => void;
  };
}

interface ServerLifecycleReconcileDeps {
  bus: Pick<EventBus, 'emit'>;
  pidManager: Pick<PidManager, 'clearPid' | 'isPidRecordCurrent' | 'readPid' | 'readPidRecord'>;
  logger: Logger;
}

function normalizePathForIdentity(value: string): string {
  return path.resolve(value);
}

function pidRecordMatchesServer(
  record: PidRecord,
  serverKey: ServerId,
  config: ServerConfig,
): boolean {
  return record.serverKey === String(serverKey)
    && normalizePathForIdentity(record.instancePath) === normalizePathForIdentity(config.instancePath)
    && normalizePathForIdentity(record.runtimeHomePath) === normalizePathForIdentity(config.runtime.homePath);
}

async function reconcileOne(
  servers: ReadonlyMap<ServerId, ServerLifecycleReconcileEntry>,
  deps: ServerLifecycleReconcileDeps,
  serverKey: ServerId,
  config: ServerConfig,
): Promise<void> {
  const entry = servers.get(serverKey);
  if (!entry) {
    return;
  }

  const { runtime } = entry;

  try {
    const record = await deps.pidManager.readPidRecord(serverKey);
    if (record) {
      if (pidRecordMatchesServer(record, serverKey, config) && deps.pidManager.isPidRecordCurrent(record)) {
        runtime.forceState('running', { pid: record.pid, startMode: runtime.lastStartMode });
        return;
      }

      await deps.pidManager.clearPid(serverKey);
      runtime.forceState('stopped');
      deps.logger.warn(`ServerLifecycle: untrusted PID record removed for '${config.name}'`);
      return;
    }

    const pid = await deps.pidManager.readPid(serverKey);

    if (!pid) {
      if (runtime.state !== 'stopped') {
        runtime.forceState('stopped');
      }
      return;
    }

    deps.logger.warn(`ServerLifecycle: legacy PID file ignored for '${config.name}'`);
    await deps.pidManager.clearPid(serverKey);
    runtime.forceState('stopped');
  } catch (error) {
    deps.logger.error(`ServerLifecycle: reconciliation error for '${config.name}'`, error);
    runtime.forceState('stopped');
  }
}

export async function reconcileRunningServers(
  servers: ReadonlyMap<ServerId, ServerLifecycleReconcileEntry>,
  deps: ServerLifecycleReconcileDeps,
  configs: Array<{ serverKey: ServerId; config: ServerConfig }>,
): Promise<void> {
  deps.logger.info(`ServerLifecycle: reconciling ${configs.length} servers`);

  const tasks = configs.map(({ serverKey, config }) => reconcileOne(servers, deps, serverKey, config));

  await Promise.race([
    Promise.all(tasks),
    sleep(RECONCILIATION_BUDGET_MS).then(() => {
      deps.logger.warn('ServerLifecycle: reconciliation budget exceeded');
    }),
  ]);

  deps.bus.emit('WorkspaceLoaded', { serverCount: configs.length });
}

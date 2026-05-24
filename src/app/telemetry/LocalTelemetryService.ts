import type { EventBus } from '@core/events/EventBus';
import type { Disposable, KeyValueStore, Logger, OperationKind } from '@core/types';

const LOCAL_TELEMETRY_KEY = 'jsm.telemetry.localMetrics.v1';

type OperationCounters = {
  succeeded: number;
  failed: number;
};

export interface LocalTelemetrySnapshot {
  version: 1;
  enabled: true;
  createdAt: string;
  updatedAt: string;
  counters: {
    operations: OperationCounters;
    operationsByKind: Record<string, OperationCounters>;
    inventory: {
      serversAdded: number;
      serversDeleted: number;
      deploymentsAdded: number;
      deploymentsRemoved: number;
    };
  };
}

export class LocalTelemetryService implements Disposable {
  private readonly store: KeyValueStore;
  private readonly logger: Logger;
  private readonly isEnabled: () => boolean;
  private readonly now: () => Date;
  private readonly disposables: Disposable[];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(deps: {
    bus: EventBus;
    store: KeyValueStore;
    logger: Logger;
    isEnabled: () => boolean;
    now?: () => Date;
  }) {
    this.store = deps.store;
    this.logger = deps.logger.child?.('telemetry.local') ?? deps.logger;
    this.isEnabled = deps.isEnabled;
    this.now = deps.now ?? (() => new Date());
    this.disposables = [
      deps.bus.on('OperationCompleted', event => this.recordOperation(event.kind, 'succeeded')),
      deps.bus.on('OperationFailed', event => this.recordOperation(event.kind, 'failed')),
      deps.bus.on('ServerAdded', () => this.recordInventory('serversAdded')),
      deps.bus.on('ServerDeleted', () => this.recordInventory('serversDeleted')),
      deps.bus.on('DeploymentAdded', () => this.recordInventory('deploymentsAdded')),
      deps.bus.on('DeploymentRemoved', () => this.recordInventory('deploymentsRemoved')),
    ];
  }

  getSnapshot(): LocalTelemetrySnapshot | undefined {
    if (!this.isEnabled()) {
      return undefined;
    }

    return this.store.get<LocalTelemetrySnapshot>(LOCAL_TELEMETRY_KEY) ?? this.emptySnapshot();
  }

  async clear(): Promise<void> {
    await this.store.delete(LOCAL_TELEMETRY_KEY);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private recordOperation(kind: OperationKind, status: keyof OperationCounters): void {
    this.record(snapshot => {
      snapshot.counters.operations[status] += 1;
      const key = String(kind);
      const byKind = snapshot.counters.operationsByKind[key] ?? { succeeded: 0, failed: 0 };
      byKind[status] += 1;
      snapshot.counters.operationsByKind[key] = byKind;
    });
  }

  private recordInventory(kind: keyof LocalTelemetrySnapshot['counters']['inventory']): void {
    this.record(snapshot => {
      snapshot.counters.inventory[kind] += 1;
    });
  }

  private record(mutator: (snapshot: LocalTelemetrySnapshot) => void): void {
    if (!this.isEnabled()) {
      return;
    }

    this.writeChain = this.writeChain
      .then(async () => {
        const snapshot = this.store.get<LocalTelemetrySnapshot>(LOCAL_TELEMETRY_KEY) ?? this.emptySnapshot();
        mutator(snapshot);
        snapshot.updatedAt = this.now().toISOString();
        await this.store.set(LOCAL_TELEMETRY_KEY, snapshot);
      })
      .catch(cause => {
        this.logger.warn('Local telemetry update failed', cause);
      });
  }

  private emptySnapshot(): LocalTelemetrySnapshot {
    const timestamp = this.now().toISOString();
    return {
      version: 1,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      counters: {
        operations: {
          succeeded: 0,
          failed: 0,
        },
        operationsByKind: {},
        inventory: {
          serversAdded: 0,
          serversDeleted: 0,
          deploymentsAdded: 0,
          deploymentsRemoved: 0,
        },
      },
    };
  }
}

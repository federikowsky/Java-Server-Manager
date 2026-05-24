import type { EventBus } from '@core/events/EventBus';
import type { Disposable, OperationHistoryEntry, ServerId } from '@core/types';

const DEFAULT_HISTORY_LIMIT = 50;

export class OperationHistoryService implements Disposable {
  private readonly history = new Map<ServerId, OperationHistoryEntry[]>();
  private readonly disposables: Disposable[];
  private readonly limit: number;

  constructor(deps: {
    bus: EventBus;
    limit?: number;
    now?: () => number;
  }) {
    const now = deps.now ?? Date.now;
    this.limit = deps.limit ?? DEFAULT_HISTORY_LIMIT;
    this.disposables = [
      deps.bus.on('OperationStarted', event => {
        this.record({
          operationId: event.operationId,
          serverId: event.serverId,
          kind: event.kind,
          targetDeploymentId: event.targetDeploymentId,
          status: 'running',
          startedAt: now(),
        });
      }),
      deps.bus.on('OperationCompleted', event => {
        this.finish(event.serverId, event.operationId, 'succeeded', now());
      }),
      deps.bus.on('OperationFailed', event => {
        this.finish(event.serverId, event.operationId, 'failed', now(), {
          errorMessage: event.error.message,
          errorCode: event.error.code,
          suggestedFix: event.error.suggestedFix,
        });
      }),
      deps.bus.on('ServerDeleted', event => {
        this.clear(event.serverId as ServerId);
        this.clear(`${event.workspaceFolderUri}::${event.serverId}` as ServerId);
      }),
    ];
  }

  getRecent(serverId: ServerId, limit = 10): OperationHistoryEntry[] {
    return [...(this.history.get(serverId) ?? [])].slice(0, limit);
  }

  clear(serverId: ServerId): void {
    this.history.delete(serverId);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.history.clear();
  }

  private record(entry: OperationHistoryEntry): void {
    const entries = this.history.get(entry.serverId) ?? [];
    this.history.set(entry.serverId, [entry, ...entries].slice(0, this.limit));
  }

  private finish(
    serverId: ServerId,
    operationId: OperationHistoryEntry['operationId'],
    status: 'succeeded' | 'failed',
    finishedAt: number,
    error?: Pick<OperationHistoryEntry, 'errorMessage' | 'errorCode' | 'suggestedFix'>,
  ): void {
    const entries = this.history.get(serverId) ?? [];
    const index = entries.findIndex(entry => entry.operationId === operationId);
    if (index < 0) {
      return;
    }

    const existing = entries[index];
    entries[index] = {
      ...existing,
      status,
      finishedAt,
      durationMs: Math.max(0, finishedAt - existing.startedAt),
      ...error,
    };
    this.history.set(serverId, entries);
  }
}

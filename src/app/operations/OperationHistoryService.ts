import type { EventBus } from '@core/events/EventBus';
import type { Disposable, OperationHistoryEntry, OperationTimelineStep, ServerId } from '@core/types';

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
        const startedAt = now();
        this.record({
          operationId: event.operationId,
          serverId: event.serverId,
          kind: event.kind,
          targetDeploymentId: event.targetDeploymentId,
          status: 'running',
          startedAt,
          timeline: [{
            stepId: 'operation',
            label: event.kind,
            kind: 'operation',
            status: 'running',
            startedAt,
            targetDeploymentId: event.targetDeploymentId,
          }],
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
      deps.bus.on('OperationStepStarted', event => {
        this.recordStep(event.serverId, event.operationId, {
          stepId: event.stepId,
          label: event.label,
          kind: event.kind,
          status: 'running',
          startedAt: now(),
          targetDeploymentId: event.targetDeploymentId,
          message: event.message,
        });
      }),
      deps.bus.on('OperationStepCompleted', event => {
        this.finishStep(event.serverId, event.operationId, event.stepId, 'succeeded', now(), {
          message: event.message,
        });
      }),
      deps.bus.on('OperationStepFailed', event => {
        this.finishStep(event.serverId, event.operationId, event.stepId, 'failed', now(), {
          errorMessage: event.error.message,
          errorCode: event.error.code,
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
    const timeline = this.finishOperationTimeline(existing, status, finishedAt, error);
    entries[index] = {
      ...existing,
      status,
      finishedAt,
      durationMs: Math.max(0, finishedAt - existing.startedAt),
      timeline,
      ...error,
    };
    this.history.set(serverId, entries);
  }

  private recordStep(
    serverId: ServerId,
    operationId: OperationHistoryEntry['operationId'],
    step: OperationTimelineStep,
  ): void {
    const entries = this.history.get(serverId) ?? [];
    const index = entries.findIndex(entry => entry.operationId === operationId);
    if (index < 0) return;

    const existing = entries[index];
    const timeline = [...(existing.timeline ?? [])];
    const stepIndex = timeline.findIndex(item => item.stepId === step.stepId);
    if (stepIndex >= 0) {
      timeline[stepIndex] = step;
    } else {
      timeline.push(step);
    }

    entries[index] = { ...existing, timeline };
    this.history.set(serverId, entries);
  }

  private finishStep(
    serverId: ServerId,
    operationId: OperationHistoryEntry['operationId'],
    stepId: string,
    status: 'succeeded' | 'failed',
    finishedAt: number,
    details?: Pick<OperationTimelineStep, 'message' | 'errorMessage' | 'errorCode'>,
  ): void {
    const entries = this.history.get(serverId) ?? [];
    const index = entries.findIndex(entry => entry.operationId === operationId);
    if (index < 0) return;

    const existing = entries[index];
    const timeline = [...(existing.timeline ?? [])];
    const stepIndex = timeline.findIndex(item => item.stepId === stepId);
    if (stepIndex < 0) return;

    const step = timeline[stepIndex];
    timeline[stepIndex] = {
      ...step,
      status,
      finishedAt,
      durationMs: Math.max(0, finishedAt - step.startedAt),
      ...details,
    };
    entries[index] = { ...existing, timeline };
    this.history.set(serverId, entries);
  }

  private finishOperationTimeline(
    entry: OperationHistoryEntry,
    status: 'succeeded' | 'failed',
    finishedAt: number,
    error?: Pick<OperationHistoryEntry, 'errorMessage' | 'errorCode' | 'suggestedFix'>,
  ): OperationTimelineStep[] {
    const timeline = [...(entry.timeline ?? [])];
    const index = timeline.findIndex(step => step.stepId === 'operation');
    if (index < 0) return timeline;

    const step = timeline[index];
    timeline[index] = {
      ...step,
      status,
      finishedAt,
      durationMs: Math.max(0, finishedAt - step.startedAt),
      errorMessage: error?.errorMessage,
      errorCode: error?.errorCode,
    };
    return timeline;
  }
}

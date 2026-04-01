import type {
  ServerConfig,
  ServerId,
  OperationContext,
  OperationKind,
  OutputSink,
} from '@core/types';
import { decideReadiness } from '@core/policy/DecisionEngine';
import { cancellationPromise, throwIfCancelled } from '@core/ops';
import { PortScanner } from '@infra/ports';
import { READINESS_PROBE_INTERVAL_MS } from '../../constants';

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * When startup monitor reported 'started' (AFTER_START_EVENT), do one port probe after a short
 * debounce instead of polling. No loop.
 */
export async function probeAfterStartupEvent(
  portScanner: PortScanner,
  config: ServerConfig,
  debounceMs: number,
  ctx: OperationContext,
): Promise<boolean> {
  await Promise.race([
    sleep(debounceMs),
    cancellationPromise(ctx.cancel, `Start operation for '${config.name}' was cancelled.`),
  ]);
  throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled.`);
  const portOpen = await portScanner.probe(config.ports.http, config.host);
  return portOpen;
}

export async function waitForHttpReadiness(
  portScanner: PortScanner,
  config: ServerConfig,
  timeoutMs: number,
  startedAt: number,
  ctx: OperationContext,
): Promise<boolean> {
  let ready = false;

  while (!ready && (Date.now() - startedAt) < timeoutMs) {
    throwIfCancelled(ctx.cancel, `Start operation for '${config.name}' was cancelled.`);
    const portOpen = await portScanner.probe(config.ports.http, config.host);
    const decision = decideReadiness({
      portOpen,
      elapsed: Date.now() - startedAt,
      timeoutMs,
    });

    if (decision === 'ready') {
      ready = true;
      break;
    }

    if (decision === 'timeout') {
      break;
    }

    await Promise.race([
      sleep(READINESS_PROBE_INTERVAL_MS),
      cancellationPromise(ctx.cancel, `Start operation for '${config.name}' was cancelled.`),
    ]);
  }

  return ready;
}

export function makeCtx(
  serverId: ServerId,
  kind: OperationKind,
  timeoutMs: number,
  cancel: OperationContext['cancel'],
  outputSink?: OutputSink,
  operationId?: OperationContext['operationId'],
): OperationContext {
  return {
    operationId: operationId ?? (`op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as OperationContext['operationId']),
    serverId,
    kind,
    startedAt: Date.now(),
    timeoutMs,
    cancel,
    progress: {
      report: (msg: string) => outputSink?.appendLine(msg),
    },
    output: {
      append: (text: string) => outputSink?.append(text),
      appendLine: (text: string) => outputSink?.appendLine(text),
      clear: () => outputSink?.clear(),
    },
  };
}

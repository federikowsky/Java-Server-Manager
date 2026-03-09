/**
 * Pure decision functions — no side effects, no dependencies on vscode or Node.
 * Each function encodes a decision table from the spec.
 */

// ── Stop Escalation (§5.5) ─────────────────────────────────────────────────

export type StopDecision = 'wait' | 'force-kill';

export function decideStopEscalation(elapsedMs: number, gracefulTimeoutMs: number): StopDecision {
  return elapsedMs >= gracefulTimeoutMs ? 'force-kill' : 'wait';
}

// ── Readiness Probe (§5.5) ─────────────────────────────────────────────────

export type ReadinessDecision = 'ready' | 'retry' | 'timeout';

export interface ProbeResult {
  portOpen: boolean;
  elapsed: number;
  timeoutMs: number;
}

export function decideReadiness(probe: ProbeResult): ReadinessDecision {
  if (probe.portOpen) return 'ready';
  if (probe.elapsed >= probe.timeoutMs) return 'timeout';
  return 'retry';
}

// ── State Guards ────────────────────────────────────────────────────────────

import type { ServerState } from '../types';

const STARTABLE: ReadonlySet<ServerState> = new Set(['stopped', 'error']);
const STOPPABLE: ReadonlySet<ServerState> = new Set(['running', 'starting']);

export function canStart(state: ServerState): boolean {
  return STARTABLE.has(state);
}

export function canStop(state: ServerState): boolean {
  return STOPPABLE.has(state);
}

export function canRestart(state: ServerState): boolean {
  return state === 'running';
}

export function canDeploy(state: ServerState): boolean {
  return state === 'running';
}

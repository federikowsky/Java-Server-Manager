export {
  decideStopEscalation,
  decideReadiness,
  canStart,
  canStop,
  canRestart,
  canDeploy,
} from './DecisionEngine';
export type { StopDecision, ReadinessDecision, ProbeResult } from './DecisionEngine';

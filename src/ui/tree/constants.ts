import type { ServerState, DeploymentState, DeploymentType } from '@core/types';

// ── View IDs ────────────────────────────────────────────────────────────────

export { VIEW_ID, VIEW_CONTAINER_ID } from '../../constants';

// ── Context Values (§7.2) ───────────────────────────────────────────────────

/** Maps ServerState → contextValue string for when-clause matching. */
export const SERVER_CONTEXT: Record<ServerState, string> = {
  stopped:  'jsm.server.stopped',
  starting: 'jsm.server.starting',
  running:  'jsm.server.running',
  stopping: 'jsm.server.stopping',
  error:    'jsm.server.error',
};

/** Maps DeploymentState → contextValue string for when-clause matching. */
export const DEPLOYMENT_CONTEXT: Record<DeploymentState, string> = {
  undeployed: 'jsm.deployment.undeployed',
  deploying:  'jsm.deployment.deploying',
  synced:     'jsm.deployment.synced',
  error:      'jsm.deployment.error',
};

export function deploymentContextValue(type: DeploymentType, state: DeploymentState): string {
  return `jsm.deployment.${type}.${state}`;
}

// ── Icon Mappings ───────────────────────────────────────────────────────────

export const SERVER_ICON: Record<ServerState, string> = {
  stopped:  'debug-stop',
  starting: 'loading~spin',
  running:  'play',
  stopping: 'loading~spin',
  error:    'error',
};

export const DEPLOYMENT_ICON: Record<DeploymentState, string> = {
  undeployed: 'circle-outline',
  deploying:  'loading~spin',
  synced:     'pass',
  error:      'error',
};

/*
 * src/core/constants/TreeViewConstants.ts
 * Centralized constants for TreeView context values and configuration
 */

import { ServerState } from '../types/domain';

export const TREE_VIEW_IDS = {
  MAIN: 'javaServerManagerView'
} as const;

export const CONTEXT_VALUES = {
  SERVER_STOPPED: 'jsm.server.stopped',
  SERVER_RUNNING: 'jsm.server.running',
  SERVER_STARTING: 'jsm.server.starting',
  SERVER_STOPPING: 'jsm.server.stopping',
  SERVER_ERROR: 'jsm.server.error',
  DEPLOYMENT_UNDEPLOYED: 'jsm.deployment.undeployed',
  DEPLOYMENT_DEPLOYING: 'jsm.deployment.deploying',
  DEPLOYMENT_SYNCED: 'jsm.deployment.synced',
  DEPLOYMENT_ERROR: 'jsm.deployment.error'
} as const;

export const SERVER_STATE_TO_CONTEXT: Record<ServerState, string> = {
  'stopped': CONTEXT_VALUES.SERVER_STOPPED,
  'running': CONTEXT_VALUES.SERVER_RUNNING,
  'starting': CONTEXT_VALUES.SERVER_STARTING,
  'stopping': CONTEXT_VALUES.SERVER_STOPPING,
  'error': CONTEXT_VALUES.SERVER_ERROR
} as const;

export const CONTEXT_PATTERNS = {
  ANY_SERVER: '/jsm\\.server\\..*/',
  ANY_DEPLOYMENT: '/jsm\\.deployment\\..*/'
} as const;

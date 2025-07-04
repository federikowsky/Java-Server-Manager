/*
 * src/core/constants/TreeViewConstants.ts
 * Centralized constants for TreeView context values and configuration
 */

import { ServerState } from '../types/domain';

export const TREE_VIEW_IDS = {
  MAIN: 'javaServerManagerView'
} as const;

export const CONTEXT_VALUES = {
  SERVER_STOPPED: 'server-stopped',
  SERVER_RUNNING: 'server-running', 
  SERVER_STARTING: 'server-starting',
  SERVER_STOPPING: 'server-stopping',
  SERVER_ERROR: 'server-error',
  DEPLOYMENT: 'deployment'
} as const;

export const SERVER_STATE_TO_CONTEXT: Record<ServerState, string> = {
  'stopped': CONTEXT_VALUES.SERVER_STOPPED,
  'running': CONTEXT_VALUES.SERVER_RUNNING,
  'starting': CONTEXT_VALUES.SERVER_STARTING,
  'stopping': CONTEXT_VALUES.SERVER_STOPPING,
  'error': CONTEXT_VALUES.SERVER_ERROR
} as const;

export const CONTEXT_PATTERNS = {
  ANY_SERVER: '/server-.*/',
  DEPLOYMENT: 'deployment'
} as const;

/** Literal union — grows when plugins are added. */
export type ServerType = 'tomcat';

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export type DeploymentState = 'undeployed' | 'deploying' | 'synced' | 'error';

export type StartMode = 'run' | 'debug';

export type DeploymentType = 'war' | 'exploded';

export type SyncMode = 'off' | 'manual' | 'auto';

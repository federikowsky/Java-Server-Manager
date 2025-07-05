// src/types/domain.ts
// -----------------------------------------------------------------------------
//  Dati che vanno serializzati su disco (.vscode/servers.json, templates)

export type ServerState       = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export type DeploymentState   = 'undeployed' | 'deploying' | 'synced' | 'error';
export type ServerType        = 'tomcat' | 'jetty' | 'jboss' | 'custom';
export type DeployType        = 'war' | 'exploded';

/* ───────────── Debug settings ───────────── */
export interface DebugSettings {
  enable      : boolean;           // se true avvio JDWP
  port?       : number;            // porta fissa; se assente auto-assign
  vmArgs?     : string;            // args extra JDWP
  attachDelay?: number;            // ms prima di auto-attach
}

/* ───────────── Server config ────────────── */
export interface ServerConfig {
  id          : string;
  name        : string;
  type        : ServerType;
  javaHome    : string;
  serverHome  : string;
  host        : string;
  port        : number;
  debug       : DebugSettings;
  autoSync    : boolean;
  envVars?    : Record<string,string>;
  vmArgs?     : string;
  logPath?    : string;

  /* graceful control / health-check */
  startupTimeout?: number;         // ms max per passare a running
  stopTimeout?   : number;         // ms per shutdown prima di kill
  healthCheckUrl?: string;         // GET → 2xx = running

  /* hook shell */
  preStartCmd?   : string;
  postStopCmd?   : string;

  workingDir?    : string;         // cwd alternativo
  pidFile        : string;         // path pid.<id>.txt

  deployments    : DeploymentConfig[];
  
  /* Additional fields for compatibility */
  env?           : string;         // Legacy environment variables as string
  validatePaths? : boolean;        // Whether to validate paths before starting
  instancePath?  : string;         // Path for instance-based servers
}

/* ───────────── Deployment config ────────── */
export interface DeploymentConfig {
  id          : string;
  name        : string;
  sourcePath  : string;
  targetPath  : string;
  renameTo?   : string;            // nome finale su server
  contextPath : string;
  type        : DeployType;
  state       : DeploymentState;
  error?      : string;
  ignoreGlobs?: string[];          // esclusioni AutoSync
}

/* ───────────── Template globale ─────────── */
export interface ServerTemplate {
  id   : string;
  name : string;
  type : ServerType;
  defaultConfig: Partial<Omit<ServerConfig,'id'|'deployments'>>;
  description? : string;
}

export interface WorkspaceServersConfig      { servers  : ServerConfig[] }
export interface GlobalServerTemplatesConfig { templates: ServerTemplate[] }
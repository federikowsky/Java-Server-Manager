// src/types/domain.ts
// -----------------------------------------------------------------------------
//  Dati che vanno serializzati su disco (.vscode/servers.json, templates)

export type ServerState       = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export type ServerType        = 'tomcat' | 'jetty' | 'wildfly' | 'weblogic' | 'generic';
export type DeploymentState   = 'undeployed' | 'deploying' | 'synced' | 'error';
export type DeployType        = 'war' | 'exploded';

/* ───────────── Debug settings ───────────── */
export interface DebugSettings {
  port?       : number;            // porta fissa; se assente auto-assign
  vmArgs?     : string;            // args extra JDWP
  attachDelay?: number;            // ms prima di auto-attach
}

/* ───────────── Server config ────────────── */
export interface ServerConfig {
  id          : string;
  name        : string;
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

  deployments    : DeploymentConfig[];
  
  /* Additional fields for compatibility */
  env?           : string;         // Legacy environment variables as string
  instancePath?  : string;         // Path for instance-based servers
}

/* ───────────── Deployment config ────────── */
/**
 * Deployment configuration that matches JSM schema exactly
 * Only contains fields that are serialized to servers.json
 */
export interface DeploymentConfig {
  id?         : string;           // Unique identifier (optional, auto-generated if not provided)
  sourcePath  : string;           // Source path (WAR file or exploded directory) - REQUIRED
  deployName? : string;           // Name for deployment in webapps folder (optional, auto-derived from sourcePath)
  type?       : DeployType;       // Deployment type (optional, auto-detected from sourcePath)
  ignoreGlobs?: string[];         // File patterns to ignore during sync
}

/**
 * Runtime deployment state - NOT serialized to servers.json
 * Persisted separately in extension storage
 */
export interface DeploymentRuntimeState {
  deploymentId: string;                     // Reference to deployment ID
  serverId    : string;                     // Reference to server ID
  state       : DeploymentState;            // Current deployment state
  error?      : string;                     // Last error message
  lastUpdated : number;                     // Timestamp of last state update
}

/**
 * Complete deployment runtime information combining config and state
 */
export interface DeploymentRuntime {
  config: DeploymentConfig;
  state : DeploymentRuntimeState;
  // Computed fields for runtime use
  displayName : string;                     // Display name derived from deployName or sourcePath
  targetPath  : string;                     // Computed target path in webapps
  contextPath : string;                     // Computed context path for URL
}

/* ───────────── Template globale ─────────── */
export interface ServerTemplate {
  id   : string;
  name : string;
  defaultConfig: Partial<Omit<ServerConfig,'id'|'deployments'>>;
  description? : string;
}

export interface WorkspaceServersConfig      { servers  : ServerConfig[] }
export interface GlobalServerTemplatesConfig { templates: ServerTemplate[] }
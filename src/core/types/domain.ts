import type { ServerId, DeploymentId, TemplateId } from './ids';
import type { ServerType, DeploymentType, SyncMode } from './enums';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

// ── Plugin Config ───────────────────────────────────────────────────────────

// ── SSL Config ───────────────────────────────────────────────────────────────

export type KeystoreType = 'PKCS12' | 'JKS';

export interface SslConfig {
  enabled: boolean;
  /** HTTPS port. Default: 8443. */
  port: number;
  /** Absolute path to keystore file. */
  keystorePath: string;
  /** Keystore password. */
  keystorePassword: string;
  /** Keystore format. Default: PKCS12. */
  keystoreType: KeystoreType;
  /** Key alias (optional, first entry if omitted). */
  keyAlias?: string;
  /** Key password (defaults to keystorePassword). */
  keyPassword?: string;
  /** Enable client certificate authentication (mTLS). Default: false. */
  clientAuth: boolean;
  /** Path to truststore file (required when clientAuth is true). */
  truststorePath?: string;
  /** Truststore password. */
  truststorePassword?: string;
  /** Truststore format. */
  truststoreType?: KeystoreType;
  /** Enabled TLS versions. Default: ['TLSv1.2', 'TLSv1.3']. */
  protocols?: string[];
  /** Cipher suite filter (OpenSSL syntax). Optional, use Tomcat defaults if omitted. */
  ciphers?: string;
}

/** Tomcat-specific options. Used when ServerConfig.type === 'tomcat'. */
export interface TomcatPluginConfig {
  type: 'tomcat';
  /** Default: 8005 — Tomcat SHUTDOWN command port. */
  shutdownPort: number;
  /** Default: true — remove AJP connector from server.xml on instancePath init. */
  disableAjp: boolean;
  /** Optional SSL/TLS configuration. */
  ssl?: SslConfig;
}

/**
 * Discriminated union of all plugin-specific config blocks.
 * To add a new plugin: define MyPluginConfig with type: '<pluginId>' and add it to this union.
 */
export type PluginConfig = TomcatPluginConfig;

// ── Hook Config ─────────────────────────────────────────────────────────────

export type HookPhase = 'pre' | 'post' | 'onError';
export type HookEvent =
  | 'lifecycle.start'
  | 'lifecycle.stop'
  | 'lifecycle.restart'
  | 'deploy.full'
  | 'deploy.incremental'
  | 'deploy.undeploy';
export type HookKind = 'command' | 'vscodeTask';

export interface HookCommandConfig {
  mode: 'shell';
  line: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface HookConfig {
  id: string;
  enabled: boolean;
  phase: HookPhase;
  event: HookEvent;
  kind: HookKind;
  /** Default: 60_000 */
  timeoutMs: number;
  /** Default: false */
  continueOnError: boolean;

  command?: HookCommandConfig;

  vscodeTask?: {
    taskName: string;
  };
}

// ── Deployment Config ───────────────────────────────────────────────────────

export type DeploymentBuildTrigger = 'manual' | 'manualAndAuto';
export type DeploymentBuildKind = 'command' | 'vscodeTask';

export interface DeploymentBuildConfig {
  enabled: boolean;
  kind: DeploymentBuildKind;
  trigger: DeploymentBuildTrigger;
  /** Default: 60_000 */
  timeoutMs: number;
  command?: HookCommandConfig;
  vscodeTask?: {
    taskName: string;
  };
}

export type DeploymentReadinessGateTrigger = 'postDeploy' | 'postStart' | 'postDeployAndStart';

export interface DeploymentReadinessGateConfig {
  enabled: boolean;
  trigger: DeploymentReadinessGateTrigger;
}

export interface DeploymentConfig {
  id: DeploymentId;
  type: DeploymentType;
  /** Absolute or workspace-relative. */
  sourcePath: string;
  /** Target name in webapps/ AND display name. */
  deployName: string;
  /** `manual` vs `auto` file-triggered sync (exploded tree or WAR file when server autosync is enabled). */
  syncMode: SyncMode;
  /** Enable hot-reload for exploded deployments. Default: false. */
  hotReload: boolean;
  /** Per-deployment ignore patterns, merged with server-level autosync.ignoreGlobs. */
  ignoreGlobs: string[];
  build?: DeploymentBuildConfig;
  readinessGate?: DeploymentReadinessGateConfig;
  hooks: HookConfig[];
  /** Optional health check path (e.g. "/myapp/health", "/actuator/health"). GET http://host:port{healthCheckPath}. */
  healthCheckPath?: string;
  /** Timeout in ms for deployment health GET. Default 5000. */
  healthCheckTimeoutMs?: number;
}

// ── Server Config ───────────────────────────────────────────────────────────

export interface ServerConfig {
  id: ServerId;
  name: string;
  /** Plugin type discriminator — literal union, not bare string. */
  type: ServerType;

  runtime: {
    /** Stable runtime reference stored with this managed server inventory entry. */
    id: string;
    /** Absolute path to server installation. Plugin maps to its own env var (e.g. CATALINA_HOME). */
    homePath: string;
    /** Cached detection result. */
    version?: string;
  };
  /** Absolute path to per-server instance directory. Plugin maps to its own env var (e.g. CATALINA_BASE). Unique per server. */
  instancePath: string;

  /** Absolute path, mandatory. */
  javaHome: string;
  /** Default: '127.0.0.1' */
  host: string;

  ports: {
    /** Default: 8080 */
    http: number;
    /** Optional. Auto-assigned via findFreePort if not specified. */
    debug?: number;
  };

  run: {
    /** Non-secret environment variables. */
    env: Record<string, string>;
    /** JVM arguments (split array, not string). */
    vmArgs: string[];
    /** Optional working directory override. */
    cwd?: string;
  };

  debug: {
    /** Default: true */
    enabled: boolean;
    /** Default: '127.0.0.1'. MUST be '127.0.0.1', 'localhost', or '::1'. */
    bind: string;
    /** Default: 1000 */
    attachDelayMs: number;
  };

  deployments: DeploymentConfig[];

  autosync: {
    /** Default: true — master switch. If false, ALL deployments ignore their syncMode. */
    enabled: boolean;
    /** Default: 400 */
    debounceMs: number;
    /** Default: 200 */
    maxBatchFiles: number;
    /** Default: 20_000_000 */
    maxBatchBytes: number;
    /** Default: 2000 */
    stormBackoffMs: number;
    /** Default: see §10.4 */
    ignoreGlobs: string[];
  };

  hooks: HookConfig[];

  timeouts?: {
    /** Default: 30_000 */
    startRunMs?: number;
    /** Default: 45_000 */
    startDebugMs?: number;
    /** Default: 20_000 */
    stopMs?: number;
    /** Default: 60_000 */
    deployFullMs?: number;
  };

  pluginConfig?: PluginConfig;
}

// ── Server Template ─────────────────────────────────────────────────────────

export interface ServerTemplate {
  id: TemplateId;
  name: string;
  pluginType: ServerType;
  /** Deep partial of ServerConfig, omitting instance-specific identity fields. */
  serverDefaults: DeepPartial<Omit<ServerConfig, 'id' | 'name' | 'instancePath'>>;
  description?: string;
}

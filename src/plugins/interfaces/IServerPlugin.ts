import type { Result } from '@core/result';
import type { JsmError } from '@core/errors/JsmError';
import type {
  ServerConfig,
  DeploymentConfig,
  ServerType,
  ServerState,
  StartMode,
  OperationContext,
  FileChangeBatch,
} from '@core/types';

// ── Plugin Capabilities ─────────────────────────────────────────────────────

export interface PluginCapabilities {
  supportsDebugAttach: boolean;
  supportsExplodedDeploy: boolean;
  supportsWarDeploy: boolean;
  supportsIncrementalDeploy: boolean;
  supportsHotReload: boolean;
  supportsLogFollow: boolean;
  supportsAutoDetect: boolean;
  supportsMultipleInstances: boolean;
  supportsSsl: boolean;
}

// ── Report Types (§6.3) ────────────────────────────────────────────────────

export interface DetectReport {
  ok: boolean;
  version?: string;
  checks: Array<{ id: string; ok: boolean; message: string }>;
  warnings: string[];
}

export interface StartupOutcome {
  state: 'started' | 'failed';
  message?: string;
  error?: JsmError;
}

export interface StartupMonitor {
  waitForOutcome(timeoutMs: number): Promise<StartupOutcome>;
  dispose(): Promise<void> | void;
}

export interface StartResult {
  pid: number;
  httpUrl?: string;
  debugPort?: number;
  hints: string[];
  startupMonitor?: StartupMonitor;
}

export interface StatusReport {
  state: ServerState;
  pid?: number;
  httpPort?: number;
  lastError?: JsmError;
}

export interface HealthReport {
  ok: boolean;
  latencyMs?: number;
}

export interface DeployPlan {
  /** Absolute path to webapps/ directory. */
  targetRoot: string;
  /** Absolute path to deployment target (file or directory). */
  targetPath: string;
  strategy: 'copy-war' | 'copy-dir' | 'incremental-dir';
  notes: string[];
}

export interface DeployResult {
  strategy: DeployPlan['strategy'];
  deployedPath: string;
  warnings: string[];
}

export interface LogSource {
  id: string;
  title: string;
  kind: 'file' | 'process-stdout';
  path?: string;
}

export interface ConfigSource {
  id: string;
  title: string;
  kind: 'file';
  path: string;
  description?: string;
  detail?: string;
}

export interface LogSources {
  primary?: LogSource;
  others: LogSource[];
}

// ── Plugin UI Metadata ─────────────────────────────────────────────────────

export interface PluginUIMetadata {
  /** Display name for the server type (e.g., "Tomcat", "Jetty") */
  displayName: string;
  /** Label for runtime home path (e.g., "CATALINA_HOME", "JETTY_HOME") */
  runtimeHomeLabel: string;
  /** Help text for runtime home path field */
  runtimeHomeHelp: string;
  /** Default server name placeholder */
  defaultName: string;
  /** Environment variables to scan for autodiscovery */
  discoveryEnvVars: string[];
  /** Common installation paths for autodiscovery */
  discoveryPaths: string[];
  /** Description for autodiscovery setting */
  discoveryDescription: string;
  /** Description for hot reload feature (if supported) */
  hotReloadDescription?: string;
}

// ── IServerPlugin Contract (§6.2) ──────────────────────────────────────────

export interface IServerPlugin {
  readonly type: ServerType;
  readonly displayName: string;

  getCapabilities(): PluginCapabilities;
  getUIMetadata(): PluginUIMetadata;

  // Detection and validation
  detectInstallation(homePath: string): Promise<Result<DetectReport, JsmError>>;
  validateConfig(config: ServerConfig): Promise<Result<void, JsmError>>;
  initializeInstancePath?(homePath: string, instancePath: string, config: ServerConfig): Promise<Result<void, JsmError>>;

  // Lifecycle
  start(ctx: OperationContext, config: ServerConfig, mode: StartMode): Promise<Result<StartResult, JsmError>>;
  stop(ctx: OperationContext, config: ServerConfig): Promise<Result<void, JsmError>>;

  // Deploy
  planDeploy(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig): Promise<Result<DeployPlan, JsmError>>;
  deployFull(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig, plan: DeployPlan): Promise<Result<DeployResult, JsmError>>;
  deployIncremental?(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig, changes: FileChangeBatch, plan: DeployPlan): Promise<Result<void, JsmError>>;
  hotReload?(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig, changes: FileChangeBatch, plan: DeployPlan): Promise<Result<void, JsmError>>;
  undeploy(ctx: OperationContext, config: ServerConfig, dep: DeploymentConfig): Promise<Result<void, JsmError>>;

  // Status
  getStatus(ctx: OperationContext, config: ServerConfig): Promise<Result<StatusReport, JsmError>>;
  healthCheck?(ctx: OperationContext, config: ServerConfig): Promise<Result<HealthReport, JsmError>>;

  // Logs
  getLogSources(config: ServerConfig): Promise<Result<LogSources, JsmError>>;

  // Config editing
  getConfigSources?(config: ServerConfig): Promise<Result<ConfigSource[], JsmError>>;

  // Defaults and cleanup
  getDefaultConfig(): Partial<ServerConfig>;
  dispose?(): Promise<void>;
}

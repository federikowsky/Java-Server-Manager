import type {
  DeploymentBuildConfig,
  DeploymentReadinessGateConfig,
  DeploymentType,
  HookConfig,
  PluginConfig,
  ServerType,
  SyncMode,
} from '@core/types';

export interface AuthoringFieldError {
  field: string;
  message: string;
  suggestedFix?: string;
}

export interface CreateServerRequest {
  name: string;
  type?: ServerType;
  runtimeHomePath: string;
  javaHome: string;
  host?: string;
  httpPort?: number;
  debugPort?: number;
  debugBind?: string;
  envProfileId?: string;
  vmArgs?: string[];
  hooks?: HookConfig[];
  pluginConfig?: PluginConfig;
}

export interface ServerAuthoringDraft {
  name: string;
  type: ServerType;
  runtimeHomePath: string;
  javaHome: string;
  host: string;
  httpPort: number;
  debugPort?: number;
  debugBind: string;
  envProfileId?: string;
  vmArgs: string[];
  hooks: HookConfig[];
  pluginConfig?: PluginConfig;
}

export type ServerDraftDefaults = Partial<ServerAuthoringDraft>;

export interface DeploymentAuthoringDraft {
  id?: string;
  type: DeploymentType;
  sourcePath: string;
  deployName: string;
  syncMode: SyncMode;
  hotReload: boolean;
  ignoreGlobs: string[];
  build?: DeploymentBuildConfig;
  readinessGate?: DeploymentReadinessGateConfig;
  hooks: HookConfig[];
  healthCheckPath?: string;
  healthCheckTimeoutMs?: number;
}

export interface TemplateAuthoringDraft {
  name: string;
  description?: string;
  scope: 'global' | 'workspace';
  pluginType: ServerType;
  serverDefaults: ServerDraftDefaults;
}

export interface ServerCreationDefaults {
  defaultHttpPort: number;
  defaultDebugPort: number;
  defaultJavaHome: string;
}

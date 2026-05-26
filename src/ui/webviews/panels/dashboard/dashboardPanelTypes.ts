import type * as vscode from 'vscode';
import type { WorkspaceServiceRegistry } from '@app/config';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { TemplateService } from '@app/templates/TemplateService';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';
import type { Logger } from '@core/types';
import type { EventBus } from '@core/events/EventBus';
import type { TrustGate } from '@core/types/runtime';
import type { OperationHistoryService } from '@app/operations';
import type { AutoSyncService } from '@app/sync/AutoSyncService';
import type { LocalTelemetryService } from '@app/telemetry';
import type { EnvironmentProfileService } from '@app/env';

export type CommandExecutionResult = {
  ok: boolean;
  message?: string;
  data?: Record<string, unknown>;
};

export interface DashboardPanelDeps {
  extensionUri: vscode.Uri;
  workspaceRegistry: WorkspaceServiceRegistry;
  lifecycle: ServerLifecycle;
  templateService: TemplateService;
  pluginRegistry: PluginRegistry;
  discoveryService: ServerDiscoveryService;
  deployService?: {
    getDeploymentState(serverId: string, deploymentId: string): string;
    getDeploymentHealth?(serverId: string, deploymentId: string): { ok: boolean; latencyMs?: number } | undefined;
  };
  operationHistory?: OperationHistoryService;
  autoSyncService?: Pick<AutoSyncService, 'getDiagnostics'>;
  localTelemetry?: Pick<LocalTelemetryService, 'clear'>;
  environmentProfileService?: Pick<EnvironmentProfileService, 'listProfiles'>;
  logger: Logger;
  bus: EventBus;
  trustGate?: TrustGate;
}

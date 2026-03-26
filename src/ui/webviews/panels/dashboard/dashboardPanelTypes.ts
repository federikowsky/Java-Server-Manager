import type * as vscode from 'vscode';
import type { WorkspaceServiceRegistry } from '@app/config';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { TemplateService } from '@app/templates/TemplateService';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';
import type { Logger } from '@core/types';
import type { EventBus } from '@core/events/EventBus';
import type { TrustGate } from '@core/types/runtime';

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
  deployService?: { getDeploymentState(serverId: string, deploymentId: string): string };
  logger: Logger;
  bus: EventBus;
  trustGate?: TrustGate;
}

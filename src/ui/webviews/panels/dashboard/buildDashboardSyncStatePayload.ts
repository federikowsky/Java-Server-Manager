import * as vscode from 'vscode';
import type { HostToWebview, SpaServerRecord } from '../../protocol';
import type { DashboardPanelDeps } from './dashboardPanelTypes';

export type DashboardSyncStatePayload = Omit<
  Extract<HostToWebview, { command: 'syncState' }>,
  'v' | 'command'
>;

export function buildDashboardSyncStatePayload(deps: DashboardPanelDeps): DashboardSyncStatePayload {
  const servers: SpaServerRecord[] = deps.workspaceRegistry.getAllServers().map(r => ({
    serverKey: r.serverKey,
    config: r.config,
    workspaceFolderUri: r.workspaceFolderUri,
    workspaceFolderName: r.workspaceFolderName,
  }));

  const runtimeStates: Record<string, unknown> = {};
  for (const server of servers) {
    const runtime = deps.lifecycle.getRuntime(server.serverKey);
    if (runtime) {
      runtimeStates[server.serverKey] = runtime.getState();
    }
  }

  const deploymentStates: Record<string, Record<string, string>> = {};
  if (deps.deployService) {
    for (const server of servers) {
      const serverKey = server.serverKey;
      const depMap: Record<string, string> = {};
        const cfg = server.config as { deployments?: Array<{ id: string }> };
        for (const dep of cfg.deployments || []) {
        try {
          depMap[dep.id] = deps.deployService.getDeploymentState(serverKey, dep.id);
        } catch {
          depMap[dep.id] = 'undeployed';
        }
      }
      if (Object.keys(depMap).length > 0) {
        deploymentStates[serverKey] = depMap;
      }
    }
  }

  const templates = deps.templateService.listScoped().map(t => ({
    template: t.template,
    scope: t.scope,
  }));

  const capabilities: Record<string, unknown> = {};
  for (const type of deps.pluginRegistry.getSupportedTypes()) {
    const plugin = deps.pluginRegistry.get(type);
    if (plugin) {
      capabilities[type] = {
        ...plugin.getCapabilities(),
        ...plugin.getUIMetadata(),
      };
    }
  }

  const workspaceFolders = deps.workspaceRegistry.getWorkspaceScopes().map(s => ({
    uri: s.uri,
    name: s.name,
  }));

  const config = vscode.workspace.getConfiguration('jsm');
  const settings = {
    defaultHttpPort: config.get('defaults.httpPort', 8080),
    defaultDebugPort: config.get('defaults.debugPort', 5005),
    defaultJavaHome: config.get('defaults.javaHome', ''),
    showStatusInSidebar: true,
  };

  const workspaceTrusted = deps.trustGate?.isTrusted() ?? vscode.workspace.isTrusted;

  return {
    servers,
    runtimeStates,
    deploymentStates,
    templates,
    capabilities,
    workspaceFolders,
    settings,
    workspaceTrusted,
  };
}

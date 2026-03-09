import * as vscode from 'vscode';
import type {
  ServerConfig,
  DeploymentConfig,
  ServerId,
  DeploymentId,
  ServerState,
  DeploymentState,
} from '@core/types';
import type { ServerRuntimeState } from '@core/types/runtime';
import {
  SERVER_CONTEXT,
  DEPLOYMENT_CONTEXT,
  SERVER_ICON,
  DEPLOYMENT_ICON,
} from './constants';
import { TREE_REFRESH_DEBOUNCE_MS, VIEW_ID } from '../../constants';

// ── Data Source Interface ───────────────────────────────────────────────────

/**
 * Injected data source so the tree provider does not depend on app-layer classes.
 */
export interface TreeDataSource {
  getAllServers(): ServerConfig[];
  getRuntimeState(serverId: ServerId): ServerRuntimeState | undefined;
  getDeploymentState(serverId: ServerId, deploymentId: DeploymentId): DeploymentState;
}

// ── Tree Nodes ──────────────────────────────────────────────────────────────

export class ServerNode extends vscode.TreeItem {
  readonly serverId: ServerId;
  readonly serverConfig: ServerConfig;

  constructor(config: ServerConfig, state: ServerState) {
    const label = `${config.type.charAt(0).toUpperCase() + config.type.slice(1)} • ${config.name}`;
    const hasDeployments = config.deployments.length > 0;

    super(
      label,
      hasDeployments
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    this.serverId = config.id;
    this.serverConfig = config;
    this.contextValue = SERVER_CONTEXT[state];
    this.description = state;
    this.iconPath = new vscode.ThemeIcon(SERVER_ICON[state]);
    this.tooltip = ServerNode.buildTooltip(config, state);
  }

  private static buildTooltip(config: ServerConfig, state: ServerState): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**${config.name}** (${config.type})\n\n`);
    md.appendMarkdown(`- **State:** ${state}\n`);
    md.appendMarkdown(`- **HTTP:** http://${config.host}:${config.ports.http}\n`);
    if (config.runtime.version) {
      md.appendMarkdown(`- **Version:** ${config.runtime.version}\n`);
    }
    md.appendMarkdown(`- **Home:** ${config.runtime.homePath}\n`);
    md.appendMarkdown(`- **Instance:** ${config.instancePath}\n`);
    return md;
  }
}

export class DeploymentNode extends vscode.TreeItem {
  readonly serverId: ServerId;
  readonly deploymentId: DeploymentId;
  readonly deploymentConfig: DeploymentConfig;

  constructor(
    serverId: ServerId,
    dep: DeploymentConfig,
    state: DeploymentState,
  ) {
    super(dep.deployName, vscode.TreeItemCollapsibleState.None);

    this.serverId = serverId;
    this.deploymentId = dep.id;
    this.deploymentConfig = dep;
    this.contextValue = DEPLOYMENT_CONTEXT[state];
    this.description = `${dep.type} • ${state}`;
    this.iconPath = new vscode.ThemeIcon(DEPLOYMENT_ICON[state]);
    this.tooltip = DeploymentNode.buildTooltip(dep, state);
  }

  private static buildTooltip(dep: DeploymentConfig, state: DeploymentState): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**${dep.deployName}**\n\n`);
    md.appendMarkdown(`- **Type:** ${dep.type}\n`);
    md.appendMarkdown(`- **State:** ${state}\n`);
    md.appendMarkdown(`- **Source:** ${dep.sourcePath}\n`);
    md.appendMarkdown(`- **Sync:** ${dep.syncMode}\n`);
    return md;
  }
}

// ── Tree Data Provider ──────────────────────────────────────────────────────

/**
 * ServerTreeViewProvider (§7.1-§7.6).
 * Provides tree data for the Java Server Manager view.
 * Coalesces refresh calls via a debounce timer (§7.1).
 */
export class ServerTreeViewProvider
  implements vscode.TreeDataProvider<ServerNode | DeploymentNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ServerNode | DeploymentNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly dataSource: TreeDataSource;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;

  constructor(dataSource: TreeDataSource) {
    this.dataSource = dataSource;
  }

  /**
   * Request a tree refresh.
   * Coalesced via dirty flag + debounce timer (50-100ms, §7.1).
   */
  requestRefresh(): void {
    this.dirty = true;
    if (this.refreshTimer) return;

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      if (this.dirty) {
        this.dirty = false;
        this._onDidChangeTreeData.fire();
      }
    }, TREE_REFRESH_DEBOUNCE_MS);
  }

  /** Force an immediate refresh (for manual refresh command). */
  forceRefresh(): void {
    this.dirty = false;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ServerNode | DeploymentNode): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: ServerNode | DeploymentNode,
  ): (ServerNode | DeploymentNode)[] {
    // Root level: server nodes
    if (!element) {
      return this.getServerNodes();
    }

    // Server children: deployment nodes
    if (element instanceof ServerNode) {
      return this.getDeploymentNodes(element);
    }

    // Deployments have no children
    return [];
  }

  private getServerNodes(): ServerNode[] {
    const configs = this.dataSource.getAllServers();
    return configs.map(config => {
      const runtimeState = this.dataSource.getRuntimeState(config.id);
      const state: ServerState = runtimeState?.state ?? 'stopped';
      return new ServerNode(config, state);
    });
  }

  private getDeploymentNodes(serverNode: ServerNode): DeploymentNode[] {
    return serverNode.serverConfig.deployments.map(dep => {
      const state = this.dataSource.getDeploymentState(
        serverNode.serverId,
        dep.id,
      );
      return new DeploymentNode(serverNode.serverId, dep, state);
    });
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Register the tree view and return the provider + disposables.
 */
export function registerTreeView(
  dataSource: TreeDataSource,
): { provider: ServerTreeViewProvider; disposables: vscode.Disposable[] } {
  const provider = new ServerTreeViewProvider(dataSource);

  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  return {
    provider,
    disposables: [treeView, { dispose: () => provider.dispose() }],
  };
}

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
import type { WorkspaceServerRecord } from '@app/config';
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
  getWorkspaceFolders(): Array<{ workspaceFolderUri: string; workspaceFolderName: string }>;
  getServers(workspaceFolderUri: string): WorkspaceServerRecord[];
  getRuntimeState(serverKey: ServerId): ServerRuntimeState | undefined;
  getDeploymentState(serverKey: ServerId, deploymentId: DeploymentId): DeploymentState;
}

// ── Tree Nodes ──────────────────────────────────────────────────────────────

export class WorkspaceNode extends vscode.TreeItem {
  readonly workspaceFolderUri: string;
  readonly workspaceFolderName: string;

  constructor(workspaceFolderUri: string, workspaceFolderName: string) {
    super(workspaceFolderName, vscode.TreeItemCollapsibleState.Expanded);
    this.workspaceFolderUri = workspaceFolderUri;
    this.workspaceFolderName = workspaceFolderName;
    this.contextValue = 'jsm.workspace';
    this.iconPath = new vscode.ThemeIcon('root-folder');
  }
}

export class ServerNode extends vscode.TreeItem {
  readonly workspaceFolderUri: string;
  readonly workspaceFolderName: string;
  readonly serverKey: ServerId;
  readonly serverId: ServerId;
  readonly serverConfig: WorkspaceServerRecord['config'];

  constructor(
    record: WorkspaceServerRecord | ServerConfig,
    state: ServerState,
    showWorkspaceLabel = false,
  ) {
    const normalizedRecord = 'config' in record
      ? record
      : {
        workspaceFolderUri: '',
        workspaceFolderName: '',
        workspaceFolderFsPath: '',
        serverId: record.id,
        serverKey: record.id,
        config: record,
      };
    const { config } = normalizedRecord;
    const label = `${config.type.charAt(0).toUpperCase() + config.type.slice(1)} • ${config.name}`;
    const hasDeployments = config.deployments.length > 0;

    super(
      label,
      hasDeployments
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    this.workspaceFolderUri = normalizedRecord.workspaceFolderUri;
    this.workspaceFolderName = normalizedRecord.workspaceFolderName;
    this.serverKey = normalizedRecord.serverKey;
    this.serverId = config.id;
    this.serverConfig = config;
    this.contextValue = SERVER_CONTEXT[state];
    this.description = showWorkspaceLabel && normalizedRecord.workspaceFolderName
      ? `${state} • ${normalizedRecord.workspaceFolderName}`
      : state;
    this.iconPath = new vscode.ThemeIcon(SERVER_ICON[state]);
    this.tooltip = ServerNode.buildTooltip(normalizedRecord, state);
  }

  private static buildTooltip(record: WorkspaceServerRecord, state: ServerState): vscode.MarkdownString {
    const { config } = record;
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**${config.name}** (${config.type})\n\n`);
    md.appendMarkdown(`- **Workspace:** ${record.workspaceFolderName}\n`);
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
  readonly workspaceFolderUri: string;
  readonly workspaceFolderName: string;
  readonly serverKey: ServerId;
  readonly serverId: ServerId;
  readonly deploymentId: DeploymentId;
  readonly deploymentConfig: DeploymentConfig;

  constructor(
    serverNode: ServerNode | ServerId,
    dep: DeploymentConfig,
    state: DeploymentState,
  ) {
    super(dep.deployName, vscode.TreeItemCollapsibleState.None);

    const normalizedServerNode = typeof serverNode === 'string'
      ? {
        workspaceFolderUri: '',
        workspaceFolderName: '',
        serverKey: serverNode,
        serverId: serverNode,
      }
      : serverNode;

    this.workspaceFolderUri = normalizedServerNode.workspaceFolderUri;
    this.workspaceFolderName = normalizedServerNode.workspaceFolderName;
    this.serverKey = normalizedServerNode.serverKey;
    this.serverId = normalizedServerNode.serverId;
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
  implements vscode.TreeDataProvider<WorkspaceNode | ServerNode | DeploymentNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    WorkspaceNode | ServerNode | DeploymentNode | undefined | void
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

  getTreeItem(element: WorkspaceNode | ServerNode | DeploymentNode): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: WorkspaceNode | ServerNode | DeploymentNode,
  ): (WorkspaceNode | ServerNode | DeploymentNode)[] {
    const workspaces = this.dataSource.getWorkspaceFolders();

    if (!element) {
      if (workspaces.length <= 1) {
        const workspaceFolderUri = workspaces[0]?.workspaceFolderUri;
        return workspaceFolderUri ? this.getServerNodes(workspaceFolderUri, false) : [];
      }

      return workspaces.map(workspace =>
        new WorkspaceNode(workspace.workspaceFolderUri, workspace.workspaceFolderName),
      );
    }

    if (element instanceof WorkspaceNode) {
      return this.getServerNodes(element.workspaceFolderUri, true);
    }

    // Server children: deployment nodes
    if (element instanceof ServerNode) {
      return this.getDeploymentNodes(element);
    }

    // Deployments have no children
    return [];
  }

  private getServerNodes(workspaceFolderUri: string, showWorkspaceLabel: boolean): ServerNode[] {
    const records = this.dataSource.getServers(workspaceFolderUri);
    return records.map(record => {
      const runtimeState = this.dataSource.getRuntimeState(record.serverKey);
      const state: ServerState = runtimeState?.state ?? 'stopped';
      return new ServerNode(record, state, showWorkspaceLabel);
    });
  }

  private getDeploymentNodes(serverNode: ServerNode): DeploymentNode[] {
    return serverNode.serverConfig.deployments.map(dep => {
      const state = this.dataSource.getDeploymentState(
        serverNode.serverKey,
        dep.id,
      );
      return new DeploymentNode(serverNode, dep, state);
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

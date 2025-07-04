/*
 * src/ui/views/ServerTreeViewProvider.ts
 * TreeDataProvider for the “Server Explorer” sidebar view.
 */

import {
  TreeDataProvider,
  TreeItem,
  ProviderResult,
  EventEmitter,
  Event,
  ThemeIcon,
  Uri,
  window,
  Disposable
} from 'vscode';

import { ServerService } from '../../services/ServerService';
import { EventBus, EventKey } from '../../core/EventBus';
import { ServerConfig, DeploymentConfig } from '../../core/types/domain';
import { Logger } from '../../core/utils/logger';
import { SERVER_STATE_TO_CONTEXT, CONTEXT_VALUES } from '../../core/constants/TreeViewConstants';

/* ───────────────────────── Tree Items ───────────────────────── */
export class ServerNode extends TreeItem {
  constructor(readonly data: ServerConfig) {
    // Show server name with state only (no port)
    const displayName = `${data.name} (${data.state})`;
    const hasDeployments = data.deployments && data.deployments.length > 0;
    super(displayName, hasDeployments ? 1 : 0);
    
    // Set icon based on state
    let iconName: string;
    switch (data.state) {
      case 'running':
        iconName = 'play-circle';
        break;
      case 'starting':
        iconName = 'loading~spin';
        break;
      case 'stopping':
        iconName = 'loading~spin';
        break;
      case 'error':
        iconName = 'error';
        break;
      case 'stopped':
      default:
        iconName = 'circle-outline';
        break;
    }
    
    this.iconPath = new ThemeIcon(iconName);
    // Use centralized context value mapping
    this.contextValue = SERVER_STATE_TO_CONTEXT[data.state] || SERVER_STATE_TO_CONTEXT.stopped;
    this.tooltip = `${data.type} @ ${data.host}:${data.port} (${data.state})${data.instancePath ? '\nInstance Path: ' + data.instancePath : ''}`;
    
    // Debug logging for context value assignment
    console.log(`🏷️ ServerNode created: ${data.name} | state: ${data.state} | contextValue: ${this.contextValue}`);
  }
}

export class DeploymentNode extends TreeItem {
  constructor(readonly parent: ServerConfig, readonly data: DeploymentConfig) {
    super(data.name, 0);
    this.contextValue = CONTEXT_VALUES.DEPLOYMENT;
    this.iconPath = new ThemeIcon('file-code');
    this.tooltip = data.contextPath;
  }
}

/* ───────────────────────── Provider ────────────────────────── */
export class ServerTreeViewProvider implements TreeDataProvider<TreeItem>, Disposable {
  private readonly emitter = new EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData: Event<TreeItem | undefined> = this.emitter.event;

  constructor(
    private readonly srvSvc: ServerService,
    bus: EventBus,
    private readonly log: Logger
  ) {
    // subscribe to relevant events to refresh UI
    const events: EventKey[] = [
      'WorkspaceLoaded',
      'ServerAdded',
      'ServerUpdated', 
      'ServerDeleted',
      'DeploymentAdded',
      'DeploymentRemoved',
      'DeploymentStateChanged',
      'ServerStateChanged',
      'ConfigChanged'
    ];
    events.forEach(e => {
      bus.on(e, (data) => {
        this.log.info(`🔄 TreeView refresh triggered by event: ${e}`);
        this.refresh();
      });
    });
  }

  refresh(node?: TreeItem) {
    this.emitter.fire(node);
  }

  /* get children */
  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    
    if (!element) {
      // Get servers directly from ServerService 
      const all = await this.srvSvc.getAllServers();
      if (!all.ok) {
        console.error('❌ TreeView load error:', all.error);
        this.log.error('TreeView load error', all.error);
        return [];
      }
      
      // Update states from runtime info - this is critical for buttons visibility
      const servers = all.value.map((server: ServerConfig) => {
        try {
          // Get real-time state from ServerService
          const stateResult = this.srvSvc.getServerState(server.id);
          if (stateResult.ok) {
            // Create updated server config with current state
            const updatedServer = { ...server, state: stateResult.value };
            console.log(`🔄 Server ${server.name} state updated: ${server.state} → ${stateResult.value}`);
            return updatedServer;
          } else {
            console.warn(`⚠️ Failed to get state for server ${server.name}: ${stateResult.error?.message}`);
            console.warn(`   This means the server is not registered in ServerManager`);
          }
        } catch (error) {
          console.warn(`⚠️ Error getting state for server ${server.name}:`, error);
        }
        
        // Return original server if state update fails
        console.log(`🔄 Server ${server.name} keeping original state: ${server.state}`);
        return server;
      });
      
      const serverNodes = servers.map((s: ServerConfig) => new ServerNode(s));
      console.log(`🌳 TreeView: Created ${serverNodes.length} server nodes with contexts:`, 
        serverNodes.map(n => `${n.label} → ${n.contextValue}`));
      
      return serverNodes;
    }

    if (element instanceof ServerNode) {
      const deployments = element.data.deployments?.map(d => new DeploymentNode(element.data, d)) || [];
      console.log(`📦 TreeView: Server ${element.data.name} has ${deployments.length} deployments`);
      return deployments;
    }
    return [];
  }

  getTreeItem(el: TreeItem): TreeItem {
    return el;
  }

  dispose() {
    this.emitter.dispose();
  }
}

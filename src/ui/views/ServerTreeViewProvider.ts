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
import { DeploymentService } from '../../services/DeploymentService';
import { AutoSyncService } from '../../services/AutoSyncService';
import { EventBus, EventKey } from '../../core/EventBus';
import { ServerConfig, DeploymentConfig, ServerState, DeploymentState } from '../../core/types/domain';
import { Logger } from '../../core/utils/logger';
import { PluginRegistry } from '../../core/server/plugins';
import { SERVER_STATE_TO_CONTEXT, CONTEXT_VALUES } from '../../core/constants/TreeViewConstants';

/* ───────────────────────── Tree Items ───────────────────────── */
export class ServerNode extends TreeItem {
  constructor(readonly data: ServerConfig, readonly currentState: ServerState = 'stopped') {
    // Show server name with state only (no port)
    const displayName = `${data.name} (${currentState})`;
    const hasDeployments = data.deployments && data.deployments.length > 0;
    super(displayName, hasDeployments ? 1 : 0);
    
    // Set icon based on state
    let iconName: string;
    switch (currentState) {
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
    this.contextValue = SERVER_STATE_TO_CONTEXT[currentState] || SERVER_STATE_TO_CONTEXT.stopped;
    
    // For now, show a simplified tooltip without server type detection
    // Server type detection is async and TreeItem constructor can't be async
    this.tooltip = `Server @ ${data.host}:${data.port} (${currentState})${data.instancePath ? '\nInstance Path: ' + data.instancePath : ''}`;
    
    // Debug logging for context value assignment
    console.log(`🏷️ ServerNode created: ${data.name} | state: ${currentState} | contextValue: ${this.contextValue}`);
  }
}

export class DeploymentNode extends TreeItem {
  constructor(readonly parent: ServerConfig, readonly data: DeploymentConfig, readonly currentState: DeploymentState = 'undeployed', readonly autoSyncEnabled: boolean = false) {
    const displayName = data.deployName || data.sourcePath.split('/').pop()?.replace('.war', '') || 'deployment';
    const autoSyncIndicator = autoSyncEnabled ? ' ✓AutoSync' : '';
    super(`${displayName}${autoSyncIndicator}`, 0);
    this.contextValue = CONTEXT_VALUES.DEPLOYMENT;
    this.iconPath = new ThemeIcon('file-code');
    this.tooltip = `Source: ${data.sourcePath}\nState: ${currentState}${autoSyncEnabled ? '\nAutoSync: Enabled' : '\nAutoSync: Disabled'}`;
  }
}

/* ───────────────────────── Provider ────────────────────────── */
export class ServerTreeViewProvider implements TreeDataProvider<TreeItem>, Disposable {
  private readonly emitter = new EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData: Event<TreeItem | undefined> = this.emitter.event;

  constructor(
    private readonly srvSvc: ServerService,
    private readonly depSvc: DeploymentService,
    private readonly autoSyncSvc: AutoSyncService,
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
      const serversWithState = all.value.map((server: ServerConfig) => {
        let currentState: ServerState = 'stopped'; // Default state
        
        try {
          // Get real-time state from ServerService
          const stateResult = this.srvSvc.getServerState(server.id);
          if (stateResult.ok) {
            currentState = stateResult.value;
            console.log(`🔄 Server ${server.name} runtime state: ${currentState}`);
          } else {
            console.warn(`⚠️ Failed to get state for server ${server.name}: ${stateResult.error?.message}`);
            console.warn(`   This means the server is not registered in ServerManager`);
          }
        } catch (error) {
          console.warn(`⚠️ Error getting state for server ${server.name}:`, error);
        }
        
        return { server, currentState };
      });
      
      const serverNodes = serversWithState.map(({ server, currentState }) => new ServerNode(server, currentState));
      console.log(`🌳 TreeView: Created ${serverNodes.length} server nodes with contexts:`, 
        serverNodes.map(n => `${n.label} → ${n.contextValue}`));
      
      return serverNodes;
    }

    if (element instanceof ServerNode) {
      const deployments = element.data.deployments?.map(d => {
        const state = this.depSvc.getDeploymentState(d.id || '');
        const autoSyncEnabled = this.autoSyncSvc.isEnabled(element.data.id, d.id || '');
        return new DeploymentNode(element.data, d, state, autoSyncEnabled);
      }) || [];
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

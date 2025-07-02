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

/* ───────────────────────── Tree Items ───────────────────────── */
export class ServerNode extends TreeItem {
  constructor(readonly data: ServerConfig) {
    // Show server name with state only (no port)
    const instanceInfo = data.instancePath ? ' [Instance]' : '';
    const displayName = `${data.name} (${data.state})${instanceInfo}`;
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
    this.contextValue = `server-${data.state}`; // Dynamic context value based on state
    this.tooltip = `${data.type} @ ${data.host}:${data.port} (${data.state})${data.instancePath ? '\nInstance Path: ' + data.instancePath : ''}`;
  }
}

export class DeploymentNode extends TreeItem {
  constructor(readonly parent: ServerConfig, readonly data: DeploymentConfig) {
    super(data.name, 0);
    this.contextValue = 'deployment';
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
      'ServerStateChanged'
    ];
    events.forEach(e => {
      bus.on(e, (data) => {
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
      const all = await this.srvSvc.getAll();
      if (!all.ok) {
        console.error('❌ TreeView load error:', all.error);
        this.log.error('TreeView load error', all.error);
        return [];
      }
      
      // Update states from runtime info
      const servers = all.value.map((s: any) => {
        // Use getServerState to get current state
        try {
          const stateResult = this.srvSvc.getServerState(s.id);
          if (stateResult.ok) {
            s.state = stateResult.value;
          }
        } catch (error) {
          // Ignore runtime info errors, keep existing state
        }
        return s;
      });
      
      return servers.map((s: ServerConfig) => new ServerNode(s));
    }

    if (element instanceof ServerNode) {
      const deployments = element.data.deployments?.map(d => new DeploymentNode(element.data, d)) || [];
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

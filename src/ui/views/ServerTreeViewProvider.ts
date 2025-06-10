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
    super(data.name, data.state === 'running' ? 1 : 0);
    this.iconPath = new ThemeIcon(data.state === 'running' ? 'play-circle' : 'circle-outline');
    this.contextValue = 'server';
    this.tooltip = `${data.type} @ ${data.host}:${data.port}`;
  }
}

class DeploymentNode extends TreeItem {
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
    console.log('🌳 TreeViewProvider: Constructor called');
    // subscribe to relevant events to refresh UI
    const events: EventKey[] = [
      'ServerAdded',
      'ServerUpdated',
      'ServerDeleted',
      'DeploymentAdded',
      'DeploymentRemoved',
      'DeploymentStateChanged',
      'ServerStateChanged'
    ];
    events.forEach(e => bus.on(e, () => this.refresh()));
    console.log('🌳 TreeViewProvider: Event listeners registered');
  }

  refresh(node?: TreeItem) {
    this.emitter.fire(node);
  }

  /* get children */
  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    console.log('🌳 TreeViewProvider: getChildren called, element:', element ? element.label : 'ROOT');
    
    if (!element) {
      const res = this.srvSvc.get(''); // dirty but we need list; re-query config directly
      const all = this.srvSvc['cfgSvc'].loadAll(); // access internal; ok for provider
      if (!all.ok) {
        console.error('❌ TreeView load error:', all.error);
        this.log.error('TreeView load error', all.error);
        return [];
      }
      console.log('📊 TreeViewProvider: Found servers:', all.value.length);
      const nodes = all.value.map(s => new ServerNode(s));
      console.log('🌳 TreeViewProvider: Created server nodes:', nodes.map(n => n.label));
      return nodes;
    }

    if (element instanceof ServerNode) {
      console.log('🌳 TreeViewProvider: Getting deployments for server:', element.label);
      const deployments = element.data.deployments.map(d => new DeploymentNode(element.data, d));
      console.log('📦 TreeViewProvider: Found deployments:', deployments.map(d => d.label));
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

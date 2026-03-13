import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { WorkspaceServiceRegistry } from '@app/config';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { TemplateService } from '@app/templates/TemplateService';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';
import type { Logger } from '@core/types';
import type { WebviewToHost, HostToWebview } from '../protocol';
import { WEBVIEW_PROTOCOL_VERSION } from '../protocol';
import { EventBus } from '@core/events/EventBus';

export interface DashboardPanelDeps {
  extensionUri: vscode.Uri;
  workspaceRegistry: WorkspaceServiceRegistry;
  lifecycle: ServerLifecycle;
  templateService: TemplateService;
  pluginRegistry: PluginRegistry;
  discoveryService: ServerDiscoveryService;
  logger: Logger;
  bus: EventBus;
}

export class DashboardPanel implements vscode.Disposable {
  static readonly viewType = 'jsm.dashboard';
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  
  constructor(private readonly deps: DashboardPanelDeps) {
    // Listen to events to push state changes to webview
    this.deps.bus.on('ServerStateChanged', (e) => {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'serverStateChanged',
        serverId: e.serverId,
        state: this.deps.lifecycle.getRuntime(e.serverId)?.getState(),
      });
    });

    this.deps.bus.on('ConfigChanged', () => {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'configChanged',
      });
      this.syncState();
    });
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
    } else {
      this.createPanel();
    }
  }

  private createPanel(): void {
    const distWebview = vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview');

    this.panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Java Server Manager',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [distWebview],
        retainContextWhenHidden: true, // Keep SPA state when switching tabs
      }
    );

    this.panel.webview.html = this.buildHtml(this.panel.webview, distWebview);

    this.panel.webview.onDidReceiveMessage(
      async (raw: unknown) => {
        if (!this.isValidProtocolMessage(raw)) return;
        await this.handleMessage(raw);
      },
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );
  }

  private async handleMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.command) {
      case 'ready':
        this.syncState();
        break;
      
      case 'executeCommand':
        try {
          await vscode.commands.executeCommand(msg.id, ...(msg.args || []));
        } catch (e) {
          this.deps.logger.error(`Error executing command ${msg.id}`, e);
          this.postError(`Error executing command: ${String(e)}`);
        }
        break;

      case 'requestWorkspaceFolders':
        this.postMessage({
          v: WEBVIEW_PROTOCOL_VERSION,
          command: 'workspaceFoldersResult',
          folders: this.deps.workspaceRegistry.getWorkspaceScopes().map(s => ({
            uri: s.uri,
            name: s.name,
          })),
        });
        break;

      // Note: We will add the config mutation handlers (updateServer, createServer, etc.) in the next step
    }
  }

  private syncState(): void {
    if (!this.panel) return;

    const servers = this.deps.workspaceRegistry.getAllServers().map(r => ({
      config: r.config,
      workspaceFolderUri: r.workspaceFolderUri,
      workspaceFolderName: r.workspaceFolderName,
    }));

    const runtimeStates: Record<string, unknown> = {};
    for (const server of servers) {
      const runtime = this.deps.lifecycle.getRuntime(server.config.id);
      if (runtime) {
        runtimeStates[server.config.id] = runtime.getState();
      }
    }

    const templates = this.deps.templateService.listScoped().map(t => ({
      template: t.template,
      scope: t.scope,
    }));

    // Gather capabilities for registered plugins
    const capabilities: Record<string, unknown> = {};
    for (const type of this.deps.pluginRegistry.getSupportedTypes()) {
      const plugin = this.deps.pluginRegistry.get(type);
      if (plugin) {
        capabilities[type] = plugin.getCapabilities();
      }
    }

    const workspaceFolders = this.deps.workspaceRegistry.getWorkspaceScopes().map(s => ({
      uri: s.uri,
      name: s.name,
    }));

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'syncState',
      servers,
      runtimeStates,
      templates,
      capabilities,
      workspaceFolders,
    });
  }

  private postMessage(msg: HostToWebview): void {
    this.panel?.webview.postMessage(msg);
  }

  private postError(message: string): void {
    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'error',
      message,
    });
  }

  private isValidProtocolMessage(raw: unknown): raw is WebviewToHost {
    if (typeof raw !== 'object' || raw === null) return false;
    const msg = raw as Record<string, unknown>;
    return msg['v'] === WEBVIEW_PROTOCOL_VERSION && typeof msg['command'] === 'string';
  }

  private buildHtml(webview: vscode.Webview, distWebview: vscode.Uri): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'webview.css'));
    const cspSource = webview.cspSource;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; font-src ${cspSource}; img-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Java Server Manager</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    // Signal SPA mode
    window.__JSM_SPA_MODE__ = true;
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

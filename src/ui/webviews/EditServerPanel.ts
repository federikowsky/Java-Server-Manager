/*
 * src/ui/webviews/EditServerPanel.ts
 * Minimal but functional webview wizard for creating / editing a ServerConfig.
 * Not production‑ready UI – provides JSON textarea the user can edit and save.
 */

import { window, Uri, ViewColumn, WebviewPanel, Disposable } from 'vscode';
import { ServerConfig, ServerTemplate } from '../../core/types/domain';
import { Result, ok, err } from '../../core/utils/result';
import { Logger } from '../../core/utils/logger';

export type PanelMode = 'create' | 'edit' | 'createFromTemplate';

interface Pending<T> {
  resolve(v: Result<T, 'CANCELED'>): void;
  panel: WebviewPanel;
  disposables: Disposable[];
}

export class EditServerPanel {
  private static pending: Pending<ServerConfig> | null = null;
  private static readonly log = Logger.getInstance().createChild('EditPanel');
  private static originalServerConfig: ServerConfig | null = null;

  /**
   * Create server instance from template - Simple defaults + EditServerPanel
   */
  static async openFromTemplate(template: ServerTemplate): Promise<Result<ServerConfig, 'CANCELED'>> {
    // Generate simple default configuration from template
    const defaultConfig: Partial<ServerConfig> = {
      id: `${template.type}_${Date.now()}`,
      name: `${template.name} Instance`,
      type: template.type,
      serverHome: template.defaultConfig.serverHome,
      javaHome: template.defaultConfig.javaHome || process.env.JAVA_HOME || '',
      host: template.defaultConfig.host || 'localhost',
      port: template.defaultConfig.port || 8080,
      state: 'stopped',
      autoSync: template.defaultConfig.autoSync || true,
      deployments: [],
      pidFile: '',
      debug: { enable: false }
    };
    
    // Open EditServerPanel with pre-filled template data
    return this.open({
      mode: 'createFromTemplate',
      data: defaultConfig as ServerConfig
    });
  }

  static async open(opts: { mode: PanelMode; data?: ServerConfig }): Promise<Result<ServerConfig, 'CANCELED'>> {
    if (this.pending) {
      this.pending.panel.reveal();
      return new Promise(r => this.pending!.resolve = r);
    }

    // Store original config for edit mode to preserve ID and other system fields
    this.originalServerConfig = opts.data || null;

    const panel = window.createWebviewPanel(
      'jsmEditServer',
      opts.mode === 'create' ? 'Create Server' : 
      opts.mode === 'createFromTemplate' ? `Create from Template: ${opts.data?.name?.split(' Instance')[0]}` :
      `Edit ${opts.data?.name}`,
      ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: false }
    );

    panel.webview.html = this.renderHtml(opts);

    const disposables: Disposable[] = [];
    const p = new Promise<Result<ServerConfig, 'CANCELED'>>(resolve => {
      this.pending = { panel, resolve, disposables };
    });

    panel.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'save') {
        try {
          const userInput = JSON.parse(msg.payload);
          
          // Parse user input and apply simple defaults
          const cfg: ServerConfig = {
            id: userInput.id || `server_${Date.now()}`,
            name: userInput.name || 'New Server',
            type: userInput.type || 'tomcat',
            serverHome: userInput.serverHome || '',
            javaHome: userInput.javaHome || process.env.JAVA_HOME || '',
            host: userInput.host || 'localhost',
            port: userInput.port || 8080,
            state: userInput.state || 'stopped',
            autoSync: userInput.autoSync !== undefined ? userInput.autoSync : true,
            deployments: userInput.deployments || [],
            pidFile: userInput.pidFile || '',
            debug: userInput.debug || { enable: false },
            ...userInput
          };
          
          // For edit mode, preserve the original ID and other system fields
          if (this.originalServerConfig) {
            cfg.id = this.originalServerConfig.id;
            // Preserve other system fields that shouldn't be overwritten
            if (this.originalServerConfig.pidFile) {
              cfg.pidFile = this.originalServerConfig.pidFile;
            }
            // Preserve deployments unless they were explicitly modified
            if (!userInput.deployments && this.originalServerConfig.deployments) {
              cfg.deployments = this.originalServerConfig.deployments;
            }
          }
          
          this.pending?.resolve(ok(cfg));
        } catch (e) {
          window.showErrorMessage('Invalid JSON – please fix');
        }
        panel.dispose();
      } else if (msg.type === 'cancel') {
        this.pending?.resolve(err('CANCELED'));
        panel.dispose();
      }
    }, undefined, disposables);

    panel.onDidDispose(() => {
      if (this.pending) {
        this.pending?.resolve(err('CANCELED'));
        this.cleanup();
      }
    }, undefined, disposables);

    return p;
  }

  private static renderHtml(opts: { mode: PanelMode; data?: ServerConfig }): string {
    let initial: string;
    
    if (opts.data) {
      // For edit mode, strip auto-generated fields from existing data
      const { id, pidFile, state, deployments, ...userFields } = opts.data;
      initial = JSON.stringify(userFields, null, 2);
    } else {
      // For create mode, show minimal template with only user-input fields
      initial = `{
  "name": "New Server",
  "javaHome": "/path/to/jdk",
  "serverHome": "/path/to/tomcat",
  "type": "tomcat",
  "host": "localhost",
  "port": 8080,
  "autoSync": false
}`;
    }
    
    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <style>
          body{ margin:0; padding:0; font-family: monospace; }
          textarea{ width:100%; height:90vh; }
          footer{ display:flex; gap:.5rem; padding:.5rem; }
        </style>
      </head>
      <body>
        <textarea id="txt">${initial.replace(/</g, '&lt;')}</textarea>
        <footer>
          <button onclick="save()">Save</button>
          <button onclick="cancel()">Cancel</button>
        </footer>
        <script>
          const vscode = acquireVsCodeApi();
          function save(){ vscode.postMessage({type:'save',payload:document.getElementById('txt').value}); }
          function cancel(){ vscode.postMessage({type:'cancel'}); }
        </script>
      </body>
      </html>
    `;
  }

  private static cleanup() {
    if (!this.pending) return;
    this.pending.disposables.forEach(d => d.dispose());
    this.pending = null;
    this.originalServerConfig = null;
  }
}

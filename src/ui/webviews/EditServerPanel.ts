/*
 * src/ui/webviews/EditServerPanel.ts
 * Minimal but functional webview wizard for creating / editing a ServerConfig.
 * Not production‑ready UI – provides JSON textarea the user can edit and save.
 */

import { window, Uri, ViewColumn, WebviewPanel, Disposable } from 'vscode';
import { ServerConfig, ServerTemplate } from '../../core/types/domain';
import { Result, ok, err } from '../../core/utils/result';
import { Logger } from '../../core/utils/logger';
import { ConfigManager } from '../../core/config/ConfigManager';

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
      name: `${template.name}`,
      type: template.type,
      serverHome: template.defaultConfig.serverHome,
      javaHome: template.defaultConfig.javaHome || process.env.JAVA_HOME || '',
      host: template.defaultConfig.host || 'localhost',
      port: template.defaultConfig.port || 8080,
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

    panel.webview.onDidReceiveMessage(async msg => {
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
          
          // Validate the configuration
          const configManager = ConfigManager.getInstance();
          const validationResult = await configManager.validateServer(cfg);
          
          if (!validationResult.ok) {
            // Send validation errors back to webview without closing panel
            panel.webview.postMessage({
              type: 'validationError',
              errors: validationResult.error.message
            });
            return;
          }
          
          this.pending?.resolve(ok(cfg));
          panel.dispose();
        } catch (e) {
          // Send JSON parsing error back to webview
          panel.webview.postMessage({
            type: 'validationError',
            errors: 'Invalid JSON format – please fix syntax errors'
          });
        }
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
      const { id, pidFile, deployments, ...userFields } = opts.data;
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
          textarea{ width:100%; height:85vh; }
          footer{ display:flex; gap:.5rem; padding:.5rem; }
          .error-panel{ 
            background-color: #ffebee; 
            border: 1px solid #f44336; 
            color: #c62828; 
            padding: 0.5rem; 
            margin: 0.5rem 0; 
            border-radius: 3px;
            display: none;
            white-space: pre-wrap;
          }
          .success-panel{
            background-color: #e8f5e8;
            border: 1px solid #4caf50;
            color: #2e7d32;
            padding: 0.5rem;
            margin: 0.5rem 0;
            border-radius: 3px;
            display: none;
          }
        </style>
      </head>
      <body>
        <div id="errorPanel" class="error-panel"></div>
        <div id="successPanel" class="success-panel">Configuration validated successfully!</div>
        <textarea id="txt">${initial.replace(/</g, '&lt;')}</textarea>
        <footer>
          <button id="saveBtn" onclick="save()">Save</button>
          <button onclick="cancel()">Cancel</button>
        </footer>
        <script>
          const vscode = acquireVsCodeApi();
          
          function save(){ 
            clearMessages();
            document.getElementById('saveBtn').disabled = true;
            document.getElementById('saveBtn').textContent = 'Validating...';
            vscode.postMessage({type:'save',payload:document.getElementById('txt').value}); 
          }
          
          function cancel(){ 
            vscode.postMessage({type:'cancel'}); 
          }
          
          function clearMessages() {
            document.getElementById('errorPanel').style.display = 'none';
            document.getElementById('successPanel').style.display = 'none';
          }
          
          function showError(message) {
            const errorPanel = document.getElementById('errorPanel');
            errorPanel.textContent = message;
            errorPanel.style.display = 'block';
            document.getElementById('saveBtn').disabled = false;
            document.getElementById('saveBtn').textContent = 'Save';
          }
          
          function showSuccess() {
            document.getElementById('successPanel').style.display = 'block';
          }
          
          // Listen for messages from extension
          window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'validationError') {
              showError(message.errors);
            }
          });
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

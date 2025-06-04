/*
 * src/ui/webviews/EditServerPanel.ts
 * Minimal but functional webview wizard for creating / editing a ServerConfig.
 * Not production‑ready UI – provides JSON textarea the user can edit and save.
 */

import { window, Uri, ViewColumn, WebviewPanel, Disposable } from 'vscode';
import { ServerConfig } from '../../core/types/domain';
import { Result, ok, err } from '../../core/utils/result';
import { Logger } from '../../core/utils/logger';

export type PanelMode = 'create' | 'edit';

interface Pending<T> {
  resolve(v: Result<T, 'CANCELED'>): void;
  panel: WebviewPanel;
  disposables: Disposable[];
}

export class EditServerPanel {
  private static pending: Pending<ServerConfig> | null = null;
  private static readonly log = Logger.getInstance().createChild('EditPanel');

  static async open(opts: { mode: PanelMode; data?: ServerConfig }): Promise<Result<ServerConfig, 'CANCELED'>> {
    if (this.pending) {
      this.pending.panel.reveal();
      return new Promise(r => this.pending!.resolve = r);
    }

    const panel = window.createWebviewPanel(
      'jsmEditServer',
      opts.mode === 'create' ? 'Create Server' : `Edit ${opts.data?.name}`,
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
          const cfg: ServerConfig = JSON.parse(msg.payload);
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
    const initial = opts.data ? JSON.stringify(opts.data, null, 2) : `{
  "name": "New Server",
  "type": "tomcat",
  "javaHome": "/path/to/jdk",
  "serverHome": "/path/to/tomcat",
  "host": "localhost",
  "port": 8080,
  "deployments": [],
  "state": "stopped",
  "autoSync": false
}`;
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
  }
}

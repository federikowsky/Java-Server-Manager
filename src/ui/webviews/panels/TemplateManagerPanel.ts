import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import type { WorkspaceScope, WorkspaceServiceRegistry } from '@app/config';
import type { ScopedTemplateEntry, TemplateService } from '@app/templates/TemplateService';
import type { Logger, ServerTemplate } from '@core/types';
import type { ServerFormPanel } from './ServerFormPanel';

type TemplateScope = 'global' | 'workspace';

type SyncMessage = {
  type: 'sync';
  templates: TemplateRecord[];
};

type TemplateRecord = {
  key: string;
  id: string;
  scope: TemplateScope;
  name: string;
  description?: string;
  runtimeHomePath?: string;
  javaHome?: string;
  host?: string;
  httpPort?: number;
  debugPort?: number;
  vmArgsText: string;
  debugBind?: string;
};

type WebviewMessage =
  | { type: 'ready' }
  | {
    type: 'save';
    originalKey?: string;
    scope: TemplateScope;
    name: string;
    description?: string;
    runtimeHomePath?: string;
    javaHome?: string;
    host?: string;
    httpPort?: number;
    debugPort?: number;
    vmArgsText?: string;
    debugBind?: string;
  }
  | { type: 'delete'; key: string }
  | { type: 'createServer'; key: string };

export interface TemplateManagerPanelDeps {
  extensionUri: vscode.Uri;
  templateService: TemplateService;
  workspaceRegistry: WorkspaceServiceRegistry;
  serverFormPanel: ServerFormPanel | {
    openCreate?(workspaceFolderUri: string, initialData?: Record<string, unknown>): void;
    openCreateWithTemplate?(workspaceFolderUri: string, template?: ServerTemplate): void;
  };
  logger: Logger;
}

export class TemplateManagerPanel implements vscode.Disposable {
  static readonly viewType = 'jsm.templateManager';

  private panel: vscode.WebviewPanel | undefined;
  private readonly extensionUri: vscode.Uri;
  private readonly templateService: TemplateService;
  private readonly workspaceRegistry: WorkspaceServiceRegistry;
  private readonly serverFormPanel: TemplateManagerPanelDeps['serverFormPanel'];
  private readonly logger: Logger;

  constructor(deps: TemplateManagerPanelDeps) {
    this.extensionUri = deps.extensionUri;
    this.templateService = deps.templateService;
    this.workspaceRegistry = deps.workspaceRegistry;
    this.serverFormPanel = deps.serverFormPanel;
    this.logger = deps.logger;
  }

  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      void this.sync();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      TemplateManagerPanel.viewType,
      'Manage Templates',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    );

    this.panel.webview.html = this.buildHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    void this.sync();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.sync();
        break;
      case 'save':
        await this.saveTemplate(message);
        break;
      case 'delete':
        await this.deleteTemplate(message.key);
        break;
      case 'createServer':
        await this.createServerFromTemplate(message.key);
        break;
    }
  }

  private async saveTemplate(message: Extract<WebviewMessage, { type: 'save' }>): Promise<void> {
    const name = message.name.trim();
    if (!name) {
      void vscode.window.showErrorMessage('JSM: Template name is required.');
      return;
    }

    const existing = message.originalKey
      ? this.templateService.listScoped().find(entry => entry.key === message.originalKey)
      : undefined;

    const template: ServerTemplate = {
      id: existing?.template.id ?? uuid(),
      name,
      description: message.description?.trim() || undefined,
      pluginType: 'tomcat',
      serverDefaults: {
        runtime: message.runtimeHomePath?.trim() ? { id: '', homePath: message.runtimeHomePath.trim() } : undefined,
        javaHome: message.javaHome?.trim() || undefined,
        host: message.host?.trim() || undefined,
        ports: message.httpPort || message.debugPort
          ? {
            http: message.httpPort ?? 8080,
            debug: message.debugPort || undefined,
          }
          : undefined,
        run: message.vmArgsText?.trim()
          ? { env: {}, vmArgs: message.vmArgsText.split('\n').map(item => item.trim()).filter(Boolean) }
          : undefined,
        debug: message.debugBind?.trim() ? { enabled: true, attachDelayMs: 1000, bind: message.debugBind.trim() } : undefined,
      },
    };

    const saveResult = await this.templateService.save(template, message.scope);
    if (!saveResult.ok) {
      void vscode.window.showErrorMessage(`JSM: ${saveResult.error.message}`);
      return;
    }

    if (existing && existing.scope !== message.scope) {
      const deleteResult = await this.templateService.delete(existing.template.id, existing.scope);
      if (!deleteResult.ok) {
        this.logger.error(`TemplateManagerPanel failed to move template scope: ${deleteResult.error.message}`);
        void vscode.window.showErrorMessage(`JSM: ${deleteResult.error.message}`);
        return;
      }
    }

    void vscode.window.showInformationMessage(`Template "${template.name}" saved.`);
    await this.sync();
  }

  private async deleteTemplate(key: string): Promise<void> {
    const entry = this.templateService.listScoped().find(item => item.key === key);
    if (!entry) {
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Delete template "${entry.template.name}" from ${entry.scope}?`,
      { modal: true },
      'Delete',
    );
    if (confirmation !== 'Delete') {
      return;
    }

    const result = await this.templateService.delete(entry.template.id, entry.scope);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`JSM: ${result.error.message}`);
      return;
    }

    void vscode.window.showInformationMessage(`Template "${entry.template.name}" deleted.`);
    await this.sync();
  }

  private async createServerFromTemplate(key: string): Promise<void> {
    const entry = this.templateService.listScoped().find(item => item.key === key);
    if (!entry) {
      return;
    }

    const scope = await this.pickWorkspaceScope(this.workspaceRegistry.getWorkspaceScopes());
    if (!scope) {
      return;
    }

    if (this.serverFormPanel.openCreateWithTemplate) {
      this.serverFormPanel.openCreateWithTemplate(scope.uri, entry.template);
    } else {
      this.serverFormPanel.openCreate?.(scope.uri, entry.template as unknown as Record<string, unknown>);
    }
    this.panel?.dispose();
  }

  private async sync(): Promise<void> {
    if (!this.panel) {
      return;
    }

    const payload: SyncMessage = {
      type: 'sync',
      templates: this.templateService.listScoped().map(entry => this.serialize(entry)),
    };

    await this.panel.webview.postMessage(payload);
  }

  private serialize(entry: ScopedTemplateEntry): TemplateRecord {
    return {
      key: entry.key,
      id: entry.template.id,
      scope: entry.scope,
      name: entry.template.name,
      description: entry.template.description,
      runtimeHomePath: entry.template.serverDefaults.runtime?.homePath,
      javaHome: entry.template.serverDefaults.javaHome,
      host: entry.template.serverDefaults.host,
      httpPort: entry.template.serverDefaults.ports?.http,
      debugPort: entry.template.serverDefaults.ports?.debug,
      vmArgsText: (entry.template.serverDefaults.run?.vmArgs ?? []).join('\n'),
      debugBind: entry.template.serverDefaults.debug?.bind,
    };
  }

  private async pickWorkspaceScope(scopes: WorkspaceScope[]): Promise<WorkspaceScope | undefined> {
    if (scopes.length === 0) {
      return undefined;
    }
    if (scopes.length === 1) {
      return scopes[0];
    }

    return vscode.window.showQuickPick(
      scopes.map(scope => ({
        label: scope.name,
        description: scope.fsPath,
        scope,
      })),
      {
        placeHolder: 'Select the workspace folder that will own this server',
        ignoreFocusOut: true,
      },
    ).then(selection => selection?.scope);
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manage Templates</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background);
      --bg-soft: color-mix(in srgb, var(--bg) 84%, var(--vscode-button-background) 6%);
      --panel: color-mix(in srgb, var(--bg) 92%, var(--vscode-editorWidget-border) 8%);
      --fg: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-button-background);
      --accent-fg: var(--vscode-button-foreground);
      --border: var(--vscode-editorWidget-border);
      --input: var(--vscode-input-background);
      --input-border: var(--vscode-input-border);
      --hover: var(--vscode-list-hoverBackground);
      --active: var(--vscode-list-activeSelectionBackground);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--fg);
      font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;
      background:
        radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 16%, transparent) 0, transparent 32%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg) 90%, black 10%), var(--bg));
    }
    .layout {
      display: grid;
      grid-template-columns: 320px 1fr;
      min-height: 100vh;
    }
    .sidebar {
      padding: 24px 18px;
      border-right: 1px solid var(--border);
      background: var(--bg-soft);
    }
    .content {
      padding: 28px;
      max-width: 920px;
    }
    .eyebrow {
      margin-bottom: 10px;
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
    }
    h1, h2 {
      margin: 0;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .hint {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .sidebar-actions, .form-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    button {
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--fg);
      padding: 9px 14px;
      cursor: pointer;
      font: inherit;
    }
    button.primary {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: transparent;
    }
    button.danger {
      border-color: color-mix(in srgb, #d04d4d 60%, var(--border) 40%);
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .template-list {
      margin-top: 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .template-card {
      width: 100%;
      padding: 14px;
      text-align: left;
      border-radius: 16px;
      background: color-mix(in srgb, var(--panel) 92%, transparent);
    }
    .template-card:hover {
      background: var(--hover);
    }
    .template-card.active {
      background: var(--active);
      border-color: color-mix(in srgb, var(--accent) 60%, var(--border) 40%);
    }
    .template-meta {
      margin-top: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .scope-badge {
      display: inline-block;
      margin-top: 8px;
      padding: 4px 8px;
      font-size: 11px;
      border-radius: 999px;
      border: 1px solid var(--border);
    }
    .empty {
      margin-top: 18px;
      padding: 16px;
      border: 1px dashed var(--border);
      border-radius: 16px;
      color: var(--muted);
    }
    .form-shell {
      padding: 24px;
      border-radius: 24px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--panel) 94%, transparent);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-top: 20px;
    }
    .field, .field-full {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .field-full {
      grid-column: 1 / -1;
    }
    label {
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    input, textarea, select {
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--input-border);
      background: var(--input);
      color: var(--fg);
      font: inherit;
    }
    textarea {
      min-height: 110px;
      resize: vertical;
    }
    .form-actions {
      margin-top: 20px;
    }
    @media (max-width: 920px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .sidebar {
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }
      .grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="eyebrow">Template Library</div>
      <h1>Manage Templates</h1>
      <p class="hint">Create templates first, then use them to create servers. Keep only reusable defaults here.</p>
      <div class="sidebar-actions">
        <button id="new-template" class="primary" type="button">New Template</button>
      </div>
      <div id="template-list" class="template-list"></div>
      <div id="empty-list" class="empty" hidden>No templates yet. Start with the defaults you reuse most often.</div>
    </aside>
    <main class="content">
      <div class="form-shell">
        <div class="eyebrow">Template Form</div>
        <h2 id="form-title">New Template</h2>
        <p class="hint">This form is intentionally smaller than full server configuration. Deployment state, hooks, and managed-instance details stay on the server side.</p>
        <div class="grid">
          <div class="field-full">
            <label for="name">Template Name</label>
            <input id="name" type="text" placeholder="Shared Tomcat 10" />
          </div>
          <div class="field-full">
            <label for="description">Description</label>
            <textarea id="description" placeholder="Optional notes about when to use this template."></textarea>
          </div>
          <div class="field-full">
            <label for="scope">Scope</label>
            <select id="scope">
              <option value="workspace">Workspace</option>
              <option value="global">Global</option>
            </select>
          </div>
          <div class="field-full">
            <label for="runtimeHomePath">Server Home</label>
            <input id="runtimeHomePath" type="text" placeholder="/opt/tomcat" />
          </div>
          <div class="field-full">
            <label for="javaHome">JAVA_HOME</label>
            <input id="javaHome" type="text" placeholder="/Library/Java/JavaVirtualMachines/..." />
          </div>
          <div class="field">
            <label for="host">Bind Host</label>
            <input id="host" type="text" placeholder="127.0.0.1" />
          </div>
          <div class="field">
            <label for="debugBind">Debug Bind</label>
            <select id="debugBind">
              <option value="">Use default</option>
              <option value="127.0.0.1">127.0.0.1</option>
              <option value="localhost">localhost</option>
              <option value="::1">::1</option>
            </select>
          </div>
          <div class="field">
            <label for="httpPort">HTTP Port</label>
            <input id="httpPort" type="number" min="1" max="65535" placeholder="8080" />
          </div>
          <div class="field">
            <label for="debugPort">Debug Port</label>
            <input id="debugPort" type="number" min="1" max="65535" placeholder="5005" />
          </div>
          <div class="field-full">
            <label for="vmArgsText">VM Arguments</label>
            <textarea id="vmArgsText" placeholder="One JVM argument per line"></textarea>
          </div>
        </div>
        <div class="form-actions">
          <button id="save-template" class="primary" type="button">Save Template</button>
          <button id="create-server" type="button">Create Server From Template</button>
          <button id="delete-template" class="danger" type="button">Delete Template</button>
        </div>
      </div>
    </main>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let templates = [];
    let selectedKey = null;

    const elements = {
      list: document.getElementById('template-list'),
      emptyList: document.getElementById('empty-list'),
      formTitle: document.getElementById('form-title'),
      name: document.getElementById('name'),
      description: document.getElementById('description'),
      scope: document.getElementById('scope'),
      runtimeHomePath: document.getElementById('runtimeHomePath'),
      javaHome: document.getElementById('javaHome'),
      host: document.getElementById('host'),
      httpPort: document.getElementById('httpPort'),
      debugPort: document.getElementById('debugPort'),
      vmArgsText: document.getElementById('vmArgsText'),
      debugBind: document.getElementById('debugBind'),
      createServer: document.getElementById('create-server'),
      deleteTemplate: document.getElementById('delete-template'),
    };

    function blankDraft() {
      return {
        name: '',
        description: '',
        scope: 'workspace',
        runtimeHomePath: '',
        javaHome: '',
        host: '',
        httpPort: '',
        debugPort: '',
        vmArgsText: '',
        debugBind: '',
      };
    }

    function currentTemplate() {
      return templates.find(item => item.key === selectedKey) || null;
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    }

    function renderList() {
      elements.list.innerHTML = '';
      elements.emptyList.hidden = templates.length > 0;
      for (const template of templates) {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'template-card' + (template.key === selectedKey ? ' active' : '');
        node.innerHTML = '<strong>' + escapeHtml(template.name) + '</strong>'
          + '<div class="template-meta">' + escapeHtml(template.description || 'No description') + '</div>'
          + '<div class="scope-badge">' + escapeHtml(template.scope) + '</div>';
        node.addEventListener('click', () => {
          selectedKey = template.key;
          render();
        });
        elements.list.appendChild(node);
      }
    }

    function renderForm() {
      const template = currentTemplate();
      const draft = template || blankDraft();
      elements.formTitle.textContent = template ? 'Edit Template' : 'New Template';
      elements.name.value = draft.name || '';
      elements.description.value = draft.description || '';
      elements.scope.value = draft.scope || 'workspace';
      elements.runtimeHomePath.value = draft.runtimeHomePath || '';
      elements.javaHome.value = draft.javaHome || '';
      elements.host.value = draft.host || '';
      elements.httpPort.value = draft.httpPort ?? '';
      elements.debugPort.value = draft.debugPort ?? '';
      elements.vmArgsText.value = draft.vmArgsText || '';
      elements.debugBind.value = draft.debugBind || '';
      elements.createServer.disabled = !template;
      elements.deleteTemplate.disabled = !template;
    }

    function render() {
      renderList();
      renderForm();
    }

    document.getElementById('new-template').addEventListener('click', () => {
      selectedKey = null;
      render();
    });

    document.getElementById('save-template').addEventListener('click', () => {
      vscode.postMessage({
        type: 'save',
        originalKey: selectedKey || undefined,
        scope: elements.scope.value,
        name: elements.name.value,
        description: elements.description.value,
        runtimeHomePath: elements.runtimeHomePath.value,
        javaHome: elements.javaHome.value,
        host: elements.host.value,
        httpPort: elements.httpPort.value ? Number(elements.httpPort.value) : undefined,
        debugPort: elements.debugPort.value ? Number(elements.debugPort.value) : undefined,
        vmArgsText: elements.vmArgsText.value,
        debugBind: elements.debugBind.value,
      });
    });

    elements.deleteTemplate.addEventListener('click', () => {
      if (!selectedKey) {
        return;
      }
      vscode.postMessage({ type: 'delete', key: selectedKey });
    });

    elements.createServer.addEventListener('click', () => {
      if (!selectedKey) {
        return;
      }
      vscode.postMessage({ type: 'createServer', key: selectedKey });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || message.type !== 'sync') {
        return;
      }
      templates = message.templates;
      if (selectedKey && !templates.some(item => item.key === selectedKey)) {
        selectedKey = null;
      }
      render();
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

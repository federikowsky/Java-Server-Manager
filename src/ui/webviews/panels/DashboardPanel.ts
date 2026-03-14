import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { WorkspaceServiceRegistry } from '@app/config';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { TemplateService } from '@app/templates/TemplateService';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';
import type { Logger } from '@core/types';
import type { WebviewToHost, HostToWebview, FormSchema } from '../protocol';
import { WEBVIEW_PROTOCOL_VERSION } from '../protocol';
import { EventBus } from '@core/events/EventBus';
import { v4 as uuid } from 'uuid';
import type { ServerFormPanel } from './ServerFormPanel';

export interface DashboardPanelDeps {
  extensionUri: vscode.Uri;
  workspaceRegistry: WorkspaceServiceRegistry;
  lifecycle: ServerLifecycle;
  templateService: TemplateService;
  pluginRegistry: PluginRegistry;
  discoveryService: ServerDiscoveryService;
  logger: Logger;
  bus: EventBus;
  serverFormPanel: ServerFormPanel;
}

export class DashboardPanel implements vscode.Disposable {
  static readonly viewType = 'jsm.dashboard';
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private currentFormId?: string;
  private currentFormMode?: 'create' | 'edit';
  private currentFormTargetId?: string;
  private lastSubmittedFormData?: Record<string, unknown>;

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
        this.currentFormId = undefined;
        this.currentFormMode = undefined;
        this.currentFormTargetId = undefined;
        this.syncState();
        break;

      case 'executeCommand':
        try {
          if (msg.id === 'jsm.internal.requestServerSchema') {
            const [mode, serverId] = msg.args as ['edit' | 'create', string?];
            await this.handleSchemaRequest(mode, serverId);
          } else if (msg.id === 'jsm.internal.requestTemplateSchema') {
            const [mode, templateId] = msg.args as ['edit' | 'create', string?];
            await this.handleTemplateSchemaRequest(mode, templateId);
          } else if (msg.id === 'jsm.server.autodiscover') {
            await this.handleAutodiscover();
          } else if (msg.id === 'jsm.template.createServer') {
            const [templateId] = msg.args as [string?];
            await this.handleTemplateCreateServer(templateId);
          } else if (msg.id === 'jsm.template.delete') {
            const [templateId] = msg.args as [string?];
            await this.handleTemplateDelete(templateId);
          } else if (msg.id === 'jsm.settings.save') {
            await this.handleSettingsSave(msg.args?.[0]);
          } else {
            await vscode.commands.executeCommand(msg.id, ...(msg.args || []));
          }
        } catch (e) {
          this.deps.logger.error(`Error executing command ${msg.id}`, e);
          this.postError(`Error executing command: ${String(e)}`);
        }
        break;

      case 'submit':
        // Store last submitted data so we can persist it when the host handler runs.
        this.lastSubmittedFormData = msg.data;

        if (this.currentFormId === 'jsm.templateForm') {
          await this.handleTemplateFormSubmit();
        } else {
          this.postError('Submit is not supported in the current view.');
        }
        break;

      case 'validate':
        // Basic pass-through validation; forms can opt-in to more complex checks if needed.
        this.postMessage({
          v: WEBVIEW_PROTOCOL_VERSION,
          command: 'validationErrors',
          errors: [],
        });
        break;

      case 'validateField':
        this.postMessage({
          v: WEBVIEW_PROTOCOL_VERSION,
          command: 'fieldValidationResult',
          field: msg.field,
        });
        break;

      case 'browse':
        await this.handleBrowse(msg.field, msg.kind, msg.filters);
        break;

      case 'cancel':
        // Reset any active form context
        this.currentFormId = undefined;
        this.currentFormMode = undefined;
        this.currentFormTargetId = undefined;
        break;

      case 'loadData':
        await this.handleLoadData(msg.id);
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

      case 'invokeFieldAction':
        if (msg.actionId === 'autodiscover' && msg.field === 'runtime.homePath') {
          await this.handleAutodiscover();
        }
        break;

      case 'updateServer':
        await this.handleUpdateServer(msg.serverId, msg.config, msg.workspaceFolderUri);
        break;

      case 'createServer':
        await this.handleCreateServer(msg.config, msg.workspaceFolderUri);
        break;

      case 'deleteServer':
        await this.handleDeleteServer(msg.serverId, msg.workspaceFolderUri);
        break;

      case 'saveTemplate':
        await this.handleSaveTemplate(msg.template, msg.scope);
        break;

      case 'deleteTemplate':
        await this.handleDeleteTemplate(msg.templateId, msg.scope);
        break;

      case 'requestDefaults':
        this.postMessage({
          v: WEBVIEW_PROTOCOL_VERSION,
          command: 'defaults',
          data: {},
        });
        break;

      default:
        this.deps.logger.warn(`[DashboardPanel] Unhandled message type: ${(msg as any).command}`);
        break;
    }
  }

  // ── CRUD Handlers ──────────────────────────────────────────────────────────

  private async handleUpdateServer(serverId: string, config: unknown, workspaceFolderUri: string): Promise<void> {
    try {
      const result = await this.deps.workspaceRegistry.updateServer(
        { workspaceFolderUri, serverId },
        config as any,
      );
      if (!result.ok) {
        this.postError(result.error.message);
        return;
      }
      this.syncState();
    } catch (e) {
      this.deps.logger.error('Error updating server', e);
      this.postError(`Error updating server: ${String(e)}`);
    }
  }

  private async handleCreateServer(config: unknown, workspaceFolderUri: string): Promise<void> {
    try {
      const result = await this.deps.workspaceRegistry.addServer(workspaceFolderUri, config as any);
      if (!result.ok) {
        this.postError(result.error.message);
        return;
      }
      this.syncState();
    } catch (e) {
      this.deps.logger.error('Error creating server', e);
      this.postError(`Error creating server: ${String(e)}`);
    }
  }

  private async handleDeleteServer(serverId: string, workspaceFolderUri: string): Promise<void> {
    try {
      const confirmation = await vscode.window.showWarningMessage(
        'Are you sure you want to delete this server?',
        { modal: true },
        'Delete',
      );
      if (confirmation !== 'Delete') {
        return;
      }

      const result = await this.deps.workspaceRegistry.removeServer({ workspaceFolderUri, serverId });
      if (!result.ok) {
        this.postError(result.error.message);
        return;
      }
      this.syncState();
    } catch (e) {
      this.deps.logger.error('Error deleting server', e);
      this.postError(`Error deleting server: ${String(e)}`);
    }
  }

  private async handleSaveTemplate(template: unknown, scope: 'global' | 'workspace'): Promise<void> {
    try {
      const result = await this.deps.templateService.save(template as any, scope);
      if (!result.ok) {
        this.postError(result.error.message);
        return;
      }
      this.syncState();
    } catch (e) {
      this.deps.logger.error('Error saving template', e);
      this.postError(`Error saving template: ${String(e)}`);
    }
  }

  private async handleDeleteTemplate(templateId: string, scope: 'global' | 'workspace'): Promise<void> {
    try {
      const confirmation = await vscode.window.showWarningMessage(
        'Are you sure you want to delete this template?',
        { modal: true },
        'Delete',
      );
      if (confirmation !== 'Delete') {
        return;
      }

      const result = await this.deps.templateService.delete(templateId, scope);
      if (!result.ok) {
        this.postError(result.error.message);
        return;
      }
      this.syncState();
    } catch (e) {
      this.deps.logger.error('Error deleting template', e);
      this.postError(`Error deleting template: ${String(e)}`);
    }
  }

  // ── Schema & Form Handlers ─────────────────────────────────────────────────

  private async handleSchemaRequest(mode: 'create' | 'edit', serverId?: string): Promise<void> {
    this.currentFormId = 'jsm.serverForm';
    this.currentFormMode = mode;
    this.currentFormTargetId = serverId;

    // Determine server type for plugin-driven labels
    let serverType = 'tomcat';
    if (mode === 'edit' && serverId) {
      const record = this.deps.workspaceRegistry.getAllServers().find(item => item.serverId === serverId);
      if (record) {
        serverType = record.config.type;
      }
    }

    // Query plugin for UI metadata
    const plugin = this.deps.pluginRegistry.get(serverType as any);
    const uiMeta = plugin?.getUIMetadata();
    const runtimeLabel = uiMeta?.runtimeHomeLabel ?? 'Server Home';
    const runtimeHelp = uiMeta?.runtimeHomeHelp ?? 'Absolute path to the server installation directory.';
    const defaultName = uiMeta?.defaultName ?? `My ${uiMeta?.displayName ?? 'Server'}`;

    const schema: FormSchema = {
      title: mode === 'create' ? `Add ${uiMeta?.displayName ?? 'Server'}` : `Edit ${uiMeta?.displayName ?? 'Server'}`,
      sections: [
        {
          id: 'runtime',
          title: 'Runtime',
          fields: [
            {
              name: 'runtime.homePath',
              label: `Server Home (${runtimeLabel})`,
              type: 'path',
              required: true,
              browse: { kind: 'directory' },
              actionButtons: [
                { id: 'autodiscover', icon: 'search', title: 'Autodiscover Server Installation' },
              ],
              helpText: runtimeHelp,
            },
          ],
        },
        {
          id: 'identity',
          title: 'Server Identity',
          fields: [
            {
              name: 'name',
              label: 'Server Name',
              type: 'text',
              required: true,
              placeholder: defaultName,
            },
            {
              name: 'ports.http',
              label: 'HTTP Port',
              type: 'port',
              required: true,
              defaultValue: 8080,
              validation: { min: 1, max: 65535 },
            },
          ],
        },
        {
          id: 'java',
          title: 'Java',
          fields: [
            {
              name: 'javaHome',
              label: 'JAVA_HOME',
              type: 'path',
              required: true,
              browse: { kind: 'directory' },
              helpText: 'Path to JDK installation. Must contain bin/java.',
            },
          ],
        },
        {
          id: 'advanced',
          title: 'Advanced',
          collapsible: true,
          fields: [
            {
              name: 'host',
              label: 'Bind Host',
              type: 'text',
              defaultValue: '127.0.0.1',
            },
            {
              name: 'run.vmArgs',
              label: 'VM Arguments',
              type: 'tags',
              helpText: 'JVM arguments (one per tag).',
            },
            {
              name: 'debug.bind',
              label: 'Debug Bind Address',
              type: 'select',
              defaultValue: '127.0.0.1',
              options: [
                { value: '127.0.0.1', label: '127.0.0.1' },
                { value: 'localhost', label: 'localhost' },
                { value: '::1', label: '::1' },
              ],
            },
            {
              name: 'ports.debug',
              label: 'Debug Port',
              type: 'port',
              helpText: 'Optional. Leave empty to auto-assign a free port.',
              validation: { min: 1, max: 65535 },
            },
          ],
        },
      ],
    };
    
    let data: Record<string, unknown> | undefined;
    if (mode === 'edit' && serverId) {
      const record = this.deps.workspaceRegistry.getAllServers().find(item => item.serverId === serverId);
      if (record) {
        data = {
          name: record.config.name,
          'runtime.homePath': record.config.runtime.homePath,
          javaHome: record.config.javaHome,
          host: record.config.host,
          'ports.http': record.config.ports.http,
          'ports.debug': record.config.ports.debug,
          'run.vmArgs': Array.isArray(record.config.run?.vmArgs) ? record.config.run.vmArgs : [],
          'debug.bind': record.config.debug?.bind ?? '127.0.0.1',
        };
      }
    }
    
    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'init',
      formId: 'jsm.serverForm',
      mode,
      schema,
      data,
    });
  }

  private buildTemplateSchema(): FormSchema {
    return {
      title: 'Template',
      sections: [
        {
          id: 'details',
          title: 'Details',
          fields: [
            {
              name: 'name',
              label: 'Template Name',
              type: 'text',
              required: true,
              placeholder: 'My Template',
            },
            {
              name: 'description',
              label: 'Description',
              type: 'textarea',
            },
          ],
        },
        {
          id: 'defaults',
          title: 'Defaults',
          fields: [
            {
              name: 'runtime.homePath',
              label: 'Runtime Home (CATALINA_HOME)',
              type: 'path',
              helpText: 'Optional default runtime home for servers created from this template.',
            },
            {
              name: 'javaHome',
              label: 'JAVA_HOME',
              type: 'path',
              helpText: 'Optional default JDK path for servers created from this template.',
            },
            {
              name: 'host',
              label: 'Host',
              type: 'text',
              defaultValue: '127.0.0.1',
              helpText: 'Optional default host for servers created from this template.',
            },
            {
              name: 'ports.http',
              label: 'HTTP Port',
              type: 'port',
              defaultValue: 8080,
              helpText: 'Optional default HTTP port for servers created from this template.',
            },
            {
              name: 'ports.debug',
              label: 'Debug Port',
              type: 'port',
              defaultValue: 5005,
              helpText: 'Optional default debug port for servers created from this template.',
            },
            {
              name: 'run.vmArgs',
              label: 'JVM Args',
              type: 'textarea',
              helpText: 'Optional default JVM arguments for servers created from this template (one per line).',
            },
            {
              name: 'debug.bind',
              label: 'Debug Bind',
              type: 'text',
              defaultValue: '127.0.0.1',
              helpText: 'Optional default debug bind address for servers created from this template.',
            },
          ],
        },
      ],
    };
  }

  private async handleTemplateSchemaRequest(mode: 'create' | 'edit', templateId?: string): Promise<void> {
    this.currentFormId = 'jsm.templateForm';
    this.currentFormMode = mode;
    this.currentFormTargetId = templateId;

    const schema = this.buildTemplateSchema();

    let data: Record<string, unknown> | undefined;
    if (mode === 'edit' && templateId) {
      const record = this.deps.templateService.listScoped().find(item => item.template.id === templateId);
      if (record) {
        const d = record.template.serverDefaults;
        data = {
          name: record.template.name,
          description: record.template.description,
          'runtime.homePath': d.runtime?.homePath,
          javaHome: d.javaHome,
          host: d.host,
          'ports.http': d.ports?.http,
          'ports.debug': d.ports?.debug,
          'run.vmArgs': Array.isArray(d.run?.vmArgs) ? d.run.vmArgs.join('\n') : undefined,
          'debug.bind': d.debug?.bind,
        };
      }
    }

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'init',
      formId: 'jsm.templateForm',
      mode,
      schema,
      data,
    });
  }

  private async handleAutodiscover(): Promise<void> {
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Discovering Java servers...',
      cancellable: false,
    }, async () => {
      const folders = this.deps.workspaceRegistry.getWorkspaceScopes().map(s => s.fsPath);
      const results = await this.deps.discoveryService.discover(folders);

      const registeredHomes = new Set<string>();
      for (const server of this.deps.workspaceRegistry.getAllServers()) {
        registeredHomes.add(server.config.runtime.homePath);
      }
      
      const newServers = results.filter(r => !registeredHomes.has(r.path));

      if (newServers.length === 0) {
        vscode.window.showInformationMessage('No unmanaged Java servers found in common locations.');
        return;
      }

      const items: vscode.QuickPickItem[] = newServers.map(s => ({
        label: `$(server) ${s.type.charAt(0).toUpperCase() + s.type.slice(1)} ${s.version ?? ''}`,
        description: s.path,
        detail: `Found in ${s.source === 'env' ? 'environment variables' : s.source === 'workspace' ? 'workspace' : 'OS common paths'}`,
      }));

      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a discovered server',
      });

      if (selection) {
        this.postMessage({
          v: WEBVIEW_PROTOCOL_VERSION,
          command: 'fieldActionResult',
          field: 'runtime.homePath',
          value: selection.description,
        });
      }
    });
  }

  private async handleTemplateCreateServer(templateId?: string): Promise<void> {
    if (!templateId) return;

    const template = this.deps.templateService.get(templateId);
    if (!template) {
      this.postError(`Template not found: ${templateId}`);
      return;
    }

    const scope = this.deps.workspaceRegistry.getWorkspaceScopes()[0];
    if (!scope) {
      this.postError('No workspace available for creating a server from template.');
      return;
    }

    this.deps.serverFormPanel.openCreateWithTemplate(scope.uri, template);
  }

  private async handleTemplateDelete(templateId?: string): Promise<void> {
    if (!templateId) return;

    const entry = this.deps.templateService.listScoped().find(item => item.template.id === templateId);
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

    const result = await this.deps.templateService.delete(entry.template.id, entry.scope);
    if (!result.ok) {
      this.postError(result.error.message);
      return;
    }

    // Refresh SPA state so the deleted template disappears.
    this.syncState();
  }

  private async handleTemplateFormSubmit(): Promise<void> {
    if (!this.currentFormId || this.currentFormId !== 'jsm.templateForm') {
      this.postError('Submit is not supported in the current view.');
      return;
    }

    // Collect form values from the webview by requesting a load (the webview keeps state in formData,
    // we can rely on it being sent back via the protocol, but as a simple approach we'll just
    // treat the current form as already synchronized and assume the last submitted data is correct.
    // The SPA will send the data on its own as part of the message; here we're only asked to
    // handle the save semantics.

    // We cannot access the SPA formData directly from the host, so we rely on the fact that
    // the SPA sends a submit with the data; we already receive it (msg.data) in handleMessage.
    // To avoid rewriting the message plumbing, we store the last submitted payload in a field.

    const lastSubmittedData = this.lastSubmittedFormData;
    if (!lastSubmittedData) {
      this.postError('No form data received.');
      return;
    }

    const templateId = this.currentFormMode === 'edit' ? this.currentFormTargetId : undefined;

    const existingEntry = templateId
      ? this.deps.templateService.listScoped().find(item => item.template.id === templateId)
      : undefined;

    const scope: 'global' | 'workspace' = existingEntry?.scope ?? 'workspace';

    const template: any = {
      id: existingEntry?.template.id ?? uuid(),
      name: String(lastSubmittedData['name'] ?? '').trim(),
      description: String(lastSubmittedData['description'] ?? '').trim() || undefined,
      pluginType: existingEntry?.template.pluginType ?? 'tomcat',
      serverDefaults: {
        runtime: { homePath: String(lastSubmittedData['runtime.homePath'] ?? '') || undefined },
        javaHome: String(lastSubmittedData['javaHome'] ?? '') || undefined,
        host: String(lastSubmittedData['host'] ?? '') || undefined,
        ports: {
          http: Number(lastSubmittedData['ports.http'] ?? undefined) || undefined,
          debug: Number(lastSubmittedData['ports.debug'] ?? undefined) || undefined,
        },
        run: {
          vmArgs: typeof lastSubmittedData['run.vmArgs'] === 'string'
            ? (lastSubmittedData['run.vmArgs'] as string).split('\n').map(s => s.trim()).filter(Boolean)
            : [],
        },
        debug: {
          bind: String(lastSubmittedData['debug.bind'] ?? '') || undefined,
        },
      },
    };

    const result = await this.deps.templateService.save(template, scope);
    // Clear cached submit payload once handled.
    this.lastSubmittedFormData = undefined;

    if (!result.ok) {
      this.postError(result.error.message);
      return;
    }

    this.syncState();
  }

  private async handleBrowse(
    field: string,
    kind: 'file' | 'directory',
    filters?: Record<string, string[]>,
  ): Promise<void> {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: kind === 'file',
      canSelectFolders: kind === 'directory',
      canSelectMany: false,
      filters,
    });

    if (!uri || uri.length === 0) {
      return;
    }

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'browsed',
      field,
      path: uri[0].fsPath,
    });
  }

  private async handleSettingsSave(settings: unknown): Promise<void> {
    if (!settings || typeof settings !== 'object') {
      this.postError('Invalid settings data');
      return;
    }

    try {
      // Persist settings to workspace configuration
      const config = vscode.workspace.getConfiguration('jsm');
      const s = settings as Record<string, unknown>;
      
      if ('autoDiscovery' in s) {
        await config.update('autoDiscovery.enabled', s.autoDiscovery, vscode.ConfigurationTarget.Global);
      }
      if ('scanEnvVars' in s) {
        await config.update('autoDiscovery.scanEnvVars', s.scanEnvVars, vscode.ConfigurationTarget.Global);
      }
      if ('scanCommonPaths' in s) {
        await config.update('autoDiscovery.scanCommonPaths', s.scanCommonPaths, vscode.ConfigurationTarget.Global);
      }
      if ('defaultHttpPort' in s) {
        await config.update('defaults.httpPort', s.defaultHttpPort, vscode.ConfigurationTarget.Global);
      }
      if ('defaultDebugPort' in s) {
        await config.update('defaults.debugPort', s.defaultDebugPort, vscode.ConfigurationTarget.Global);
      }
      if ('defaultJavaHome' in s) {
        await config.update('defaults.javaHome', s.defaultJavaHome, vscode.ConfigurationTarget.Global);
      }

      this.deps.logger.info('Settings saved successfully');
    } catch (e) {
      this.deps.logger.error('Error saving settings', e);
      this.postError(`Error saving settings: ${String(e)}`);
    }
  }

  private async handleLoadData(_id?: string): Promise<void> {
    if (!this.panel) return;

    if (this.currentFormId === 'jsm.serverForm' && this.currentFormMode === 'edit' && this.currentFormTargetId) {
      const record = this.deps.workspaceRegistry.getAllServers().find(item => item.serverId === this.currentFormTargetId);
      if (record) {
        const data = {
          name: record.config.name,
          'runtime.homePath': record.config.runtime.homePath,
          'ports.http': record.config.ports.http,
          'ports.debug': record.config.ports.debug,
          // Add other fields as needed
        };

        this.postMessage({
          v: WEBVIEW_PROTOCOL_VERSION,
          command: 'loaded',
          data,
        });
      }
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

    // Gather capabilities and UI metadata for registered plugins
    const capabilities: Record<string, unknown> = {};
    for (const type of this.deps.pluginRegistry.getSupportedTypes()) {
      const plugin = this.deps.pluginRegistry.get(type);
      if (plugin) {
        capabilities[type] = {
          ...plugin.getCapabilities(),
          ...plugin.getUIMetadata(),
        };
      }
    }

    const workspaceFolders = this.deps.workspaceRegistry.getWorkspaceScopes().map(s => ({
      uri: s.uri,
      name: s.name,
    }));

    // Load global settings
    const config = vscode.workspace.getConfiguration('jsm');
    const settings = {
      autoDiscovery: config.get('autoDiscovery.enabled', true),
      scanEnvVars: config.get('autoDiscovery.scanEnvVars', true),
      scanCommonPaths: config.get('autoDiscovery.scanCommonPaths', true),
      defaultHttpPort: config.get('defaults.httpPort', 8080),
      defaultDebugPort: config.get('defaults.debugPort', 5005),
      defaultJavaHome: config.get('defaults.javaHome', ''),
    };

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'syncState',
      servers,
      runtimeStates,
      templates,
      capabilities,
      workspaceFolders,
      settings,
    } as any);
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

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { WorkspaceServiceRegistry } from '@app/config';
import type { ServerLifecycle } from '@app/server/ServerLifecycle';
import type { TemplateService } from '@app/templates/TemplateService';
import {
  formDataToServerConfig,
  formDataToTemplateDraft,
  serverConfigToFormData,
  templateDraftToTemplate,
  templateToServerFormData,
  validateServerForm,
} from '@core/authoring';
import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';
import type { Logger } from '@core/types';
import type { DashboardNavigationTarget, HostToWebview, FormSchema, WebviewToHost } from '../protocol';
import { WEBVIEW_PROTOCOL_VERSION } from '../protocol';
import { EventBus } from '@core/events/EventBus';
import { v4 as uuid } from 'uuid';
import { areHookTaskOptionsEqual, fetchHookTaskOptions, type HookTaskOption } from '../hookTaskOptions';
import { requireWorkspaceTrust } from '@core/policy';
import type { TrustGate } from '@core/types/runtime';
import { normalizeDashboardNavigationTarget } from '../dashboardNavigation';

type CommandExecutionResult = {
  ok: boolean;
  message?: string;
  data?: Record<string, unknown>;
};

export interface DashboardPanelDeps {
  extensionUri: vscode.Uri;
  workspaceRegistry: WorkspaceServiceRegistry;
  lifecycle: ServerLifecycle;
  templateService: TemplateService;
  pluginRegistry: PluginRegistry;
  discoveryService: ServerDiscoveryService;
  deployService?: { getDeploymentState(serverId: string, deploymentId: string): string };
  logger: Logger;
  bus: EventBus;
  trustGate?: TrustGate;
}

export class DashboardPanel implements vscode.Disposable {
  static readonly viewType = 'jsm.dashboard';
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private isWebviewReady = false;
  private currentFormId?: string;
  private currentFormMode?: 'create' | 'edit';
  private currentFormTargetId?: string;
  private currentFormTargetWorkspaceFolderUri?: string;
  private currentFormTargetScope?: 'global' | 'workspace';
  private lastSubmittedFormData?: Record<string, unknown>;
  private pendingNavigationTarget?: DashboardNavigationTarget;
  private hookTaskOptions: HookTaskOption[] = [];
  private readonly panelLog: Logger;

  constructor(private readonly deps: DashboardPanelDeps) {
    this.panelLog = deps.logger.child?.('webview.dashboard') ?? deps.logger;

    // Listen to events to push state changes to webview
    this.deps.bus.on('ServerStateChanged', (e) => {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'serverStateChanged',
        serverKey: e.serverId,
        state: this.deps.lifecycle.getRuntime(e.serverId)?.getState(),
      });
    });

    this.deps.bus.on('ConfigChanged', (e) => {
      this.panelLog.debug('event.ConfigChanged', {
        source: e.source,
        workspaceFolderUri: e.workspaceFolderUri,
      });
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'configChanged',
      });
      this.syncState();
    });

    const inventorySync = (reason: string, extra?: Record<string, unknown>) => {
      this.panelLog.debug('syncState.trigger', { reason, ...extra });
      this.syncState();
    };

    this.deps.bus.on('ServerAdded', e => {
      inventorySync('ServerAdded', { serverId: e.serverId, workspaceFolderUri: e.workspaceFolderUri });
    });
    this.deps.bus.on('ServerDeleted', e => {
      inventorySync('ServerDeleted', { serverId: e.serverId, workspaceFolderUri: e.workspaceFolderUri });
    });
    this.deps.bus.on('ServerUpdated', e => {
      inventorySync('ServerUpdated', { serverId: e.serverId, workspaceFolderUri: e.workspaceFolderUri });
    });
    this.deps.bus.on('DeploymentAdded', e => {
      inventorySync('DeploymentAdded', {
        serverId: e.serverId,
        deploymentId: e.deploymentId,
        workspaceFolderUri: e.workspaceFolderUri,
      });
    });
    this.deps.bus.on('DeploymentUpdated', e => {
      inventorySync('DeploymentUpdated', {
        serverId: e.serverId,
        deploymentId: e.deploymentId,
        workspaceFolderUri: e.workspaceFolderUri,
      });
    });
    this.deps.bus.on('DeploymentRemoved', e => {
      inventorySync('DeploymentRemoved', {
        serverId: e.serverId,
        deploymentId: e.deploymentId,
        workspaceFolderUri: e.workspaceFolderUri,
      });
    });

    this.deps.bus.on('DeploymentStateChanged', (e: any) => {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'deploymentStateChanged',
        serverKey: e.serverId,
        deploymentId: e.deploymentId,
        state: e.state,
      });
    });
  }

  show(target?: DashboardNavigationTarget): void {
    if (target) {
      const normalized = normalizeDashboardNavigationTarget(target);
      this.panelLog.debug('navigate.show', {
        type: normalized.type,
        globalTab: normalized.globalTab,
        id: normalized.id,
        serverId: normalized.serverId,
      });
      this.pendingNavigationTarget = normalized;
    }
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.flushPendingNavigation();
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
        this.isWebviewReady = false;
      },
      undefined,
      this.disposables
    );

    void this.refreshHookTaskOptions();
  }

  private async refreshHookTaskOptions(): Promise<void> {
    const nextTaskOptions = await fetchHookTaskOptions(this.deps.logger);
    if (areHookTaskOptionsEqual(this.hookTaskOptions, nextTaskOptions)) {
      return;
    }

    this.hookTaskOptions = nextTaskOptions;
    this.pushHookTaskOptions();
  }

  private pushHookTaskOptions(): void {
    if (!this.panel || !this.isWebviewReady) {
      return;
    }

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'hookOptions',
      fields: ['hooks'],
      taskOptions: this.hookTaskOptions,
    });
  }

  private async handleMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.command) {
      case 'traceLog':
        this.panelLog.debug('client.trace', { message: msg.message, data: msg.data });
        break;

      case 'ready':
        this.isWebviewReady = true;
        this.currentFormId = undefined;
        this.currentFormMode = undefined;
        this.currentFormTargetId = undefined;
        this.currentFormTargetWorkspaceFolderUri = undefined;
        this.currentFormTargetScope = undefined;
        this.syncState();
        this.flushPendingNavigation();
        this.pushHookTaskOptions();
        void this.refreshHookTaskOptions();
        break;

      case 'executeCommand': {
        let commandResult: CommandExecutionResult | undefined;
        try {
          if (msg.id === 'jsm.internal.requestServerSchema') {
            const [mode, serverId, workspaceFolderUri] = msg.args as ['edit' | 'create', string?, string?];
            await this.handleSchemaRequest(mode, serverId, workspaceFolderUri);
          } else if (msg.id === 'jsm.internal.requestTemplateSchema') {
            const [mode, templateId] = msg.args as ['edit' | 'create', string?];
            await this.handleTemplateSchemaRequest(mode, templateId);
          } else if (msg.id === 'jsm.server.autodiscover') {
            await this.handleAutodiscover();
          } else if (msg.id === 'jsm.java.detect') {
            await this.handleJavaDetect();
          } else if (msg.id === 'jsm.template.createServer') {
            const [templateId] = msg.args as [string?];
            commandResult = await this.handleTemplateCreateServer(templateId);
          } else if (msg.id === 'jsm.template.delete') {
            const [templateId] = msg.args as [string?];
            commandResult = await this.handleTemplateDelete(templateId);
          } else if (msg.id === 'jsm.settings.save') {
            commandResult = await this.handleSettingsSave(msg.args?.[0]);
          } else if (msg.id === 'jsm.server.add') {
            const first = msg.args?.[0];
            const argShape = first && typeof first === 'object'
              ? {
                  hasWorkspaceFolderUri: 'workspaceFolderUri' in (first as object),
                  hasDraft: 'draft' in (first as object),
                  hasConfig: 'config' in (first as object),
                  workspaceFolderUriLen: typeof (first as { workspaceFolderUri?: string }).workspaceFolderUri === 'string'
                    ? (first as { workspaceFolderUri: string }).workspaceFolderUri.length
                    : undefined,
                }
              : { note: 'first arg missing or not object' };
            this.panelLog.debug('command.jsm.server.add.before', { requestId: msg.requestId, argShape });
            const raw = await vscode.commands.executeCommand(msg.id, ...(msg.args || []));
            commandResult = this.normalizeCommandResult(raw);
            this.panelLog.debug('command.jsm.server.add.after', {
              requestId: msg.requestId,
              ok: commandResult.ok,
              message: commandResult.message,
              dataServerId: commandResult.data?.serverId,
            });
          } else {
            commandResult = this.normalizeCommandResult(
              await vscode.commands.executeCommand(msg.id, ...(msg.args || [])),
            );
          }
        } catch (e) {
          this.deps.logger.error(`Error executing command ${msg.id}`, e);
          const message = `Error executing command: ${String(e)}`;
          this.postError(message);
          if (msg.requestId) {
            this.postCommandResult(msg.requestId, { ok: false, message });
          }
          break;
        }
        if (msg.requestId) {
          this.postCommandResult(msg.requestId, commandResult ?? { ok: true });
        }
        break;
      }

      case 'submit':
        // Store last submitted data so we can persist it when the host handler runs.
        this.lastSubmittedFormData = msg.data;

        if (this.currentFormId === 'jsm.serverForm') {
          await this.handleServerFormSubmit();
        } else if (this.currentFormId === 'jsm.templateForm') {
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
        this.currentFormTargetWorkspaceFolderUri = undefined;
        this.currentFormTargetScope = undefined;
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

      case 'deleteServer':
        await this.handleDeleteServer(msg.serverId, msg.workspaceFolderUri);
        break;

      case 'saveTemplate':
        await this.handleSaveTemplate(msg.template, msg.scope);
        break;

      case 'deleteTemplate':
        await this.handleDeleteTemplate(msg.templateId, msg.scope);
        break;

      default:
        this.deps.logger.warn(`[DashboardPanel] Unhandled message type: ${(msg as any).command}`);
        break;
    }
  }

  // ── CRUD Handlers ──────────────────────────────────────────────────────────

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

  private async handleSaveTemplate(template: unknown, scope: 'global' | 'workspace'): Promise<CommandExecutionResult> {
    try {
      const result = await this.deps.templateService.save(template as any, scope);
      if (!result.ok) {
        this.postError(result.error.message);
        return { ok: false, message: result.error.message };
      }
      this.syncState();
      return { ok: true };
    } catch (e) {
      this.deps.logger.error('Error saving template', e);
      const message = `Error saving template: ${String(e)}`;
      this.postError(message);
      return { ok: false, message };
    }
  }

  private async handleDeleteTemplate(templateId: string, scope: 'global' | 'workspace'): Promise<CommandExecutionResult> {
    try {
      const confirmation = await vscode.window.showWarningMessage(
        'Are you sure you want to delete this template?',
        { modal: true },
        'Delete',
      );
      if (confirmation !== 'Delete') {
        return { ok: false, message: 'Template deletion cancelled.' };
      }

      const result = await this.deps.templateService.delete(templateId, scope);
      if (!result.ok) {
        this.postError(result.error.message);
        return { ok: false, message: result.error.message };
      }
      this.syncState();
      return { ok: true };
    } catch (e) {
      this.deps.logger.error('Error deleting template', e);
      const message = `Error deleting template: ${String(e)}`;
      this.postError(message);
      return { ok: false, message };
    }
  }

  // ── Schema & Form Handlers ─────────────────────────────────────────────────

  private async handleSchemaRequest(
    mode: 'create' | 'edit',
    serverId?: string,
    workspaceFolderUri?: string,
  ): Promise<void> {
    this.currentFormId = 'jsm.serverForm';
    this.currentFormMode = mode;
    this.currentFormTargetId = serverId;
    this.currentFormTargetWorkspaceFolderUri = workspaceFolderUri;
    this.currentFormTargetScope = undefined;

    const record = mode === 'edit' && serverId
      ? (
        workspaceFolderUri
          ? this.deps.workspaceRegistry.getAllServers().find(item =>
            item.serverId === serverId && item.workspaceFolderUri === workspaceFolderUri)
          : this.deps.workspaceRegistry.getAllServers().find(item => item.serverId === serverId)
      )
      : undefined;
    const serverType = record?.config.type ?? 'tomcat';
    const plugin = this.deps.pluginRegistry.get(serverType as any);
    const uiMeta = plugin?.getUIMetadata();
    const capabilities = plugin?.getCapabilities();
    const config = vscode.workspace.getConfiguration('jsm');

    const schema: FormSchema = {
      title: mode === 'create' ? `Add ${uiMeta?.displayName ?? 'Server'}` : `Edit ${uiMeta?.displayName ?? 'Server'}`,
      sections: [
        {
          id: 'runtime',
          title: 'Runtime',
          fields: [
            {
              name: 'runtime.homePath',
              label: `Server Home (${uiMeta?.runtimeHomeLabel ?? 'Server Home'})`,
              type: 'path',
              required: true,
              browse: { kind: 'directory' },
              actionButtons: [
                { id: 'autodiscover', icon: 'search', title: 'Autodiscover Server Installation' },
              ],
              helpText: uiMeta?.runtimeHomeHelp ?? 'Absolute path to the server installation directory.',
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
              placeholder: uiMeta?.defaultName ?? 'My Server',
            },
            {
              name: 'ports.http',
              label: 'HTTP Port',
              type: 'port',
              required: true,
              defaultValue: config.get('defaults.httpPort', 8080),
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
            {
              name: 'hooks',
              label: 'Hooks',
              type: 'hooks',
              defaultValue: [],
              helpText: 'Configure server hooks as terminal commands or VS Code tasks.',
              hookOptions: {
                taskOptions: this.hookTaskOptions,
              },
            },
          ],
        },
        ...(capabilities?.supportsSsl
          ? [{
            id: 'ssl',
            title: 'SSL/TLS',
            collapsible: true,
            fields: [
              {
                name: 'pluginConfig.ssl.enabled',
                label: 'Enable SSL/HTTPS',
                type: 'checkbox',
                defaultValue: false,
              },
              {
                name: 'pluginConfig.ssl.port',
                label: 'HTTPS Port',
                type: 'port',
                defaultValue: 8443,
                validation: { min: 1, max: 65535 },
                visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
              },
              {
                name: 'pluginConfig.ssl.keystorePath',
                label: 'Keystore File',
                type: 'path',
                browse: { kind: 'file', filters: { Keystore: ['p12', 'pfx', 'jks'] } },
                visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
              },
              {
                name: 'pluginConfig.ssl.keystorePassword',
                label: 'Keystore Password',
                type: 'password',
                visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
              },
              {
                name: 'pluginConfig.ssl.keystoreType',
                label: 'Keystore Type',
                type: 'select',
                defaultValue: 'PKCS12',
                options: [
                  { value: 'PKCS12', label: 'PKCS12 (recommended)' },
                  { value: 'JKS', label: 'JKS' },
                ],
                visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
              },
              {
                name: 'pluginConfig.ssl.keyAlias',
                label: 'Key Alias',
                type: 'text',
                visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
              },
              {
                name: 'pluginConfig.ssl.clientAuth',
                label: 'Client Certificate Authentication (mTLS)',
                type: 'checkbox',
                defaultValue: false,
                visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
              },
              {
                name: 'pluginConfig.ssl.truststorePath',
                label: 'Truststore File',
                type: 'path',
                browse: { kind: 'file', filters: { Truststore: ['p12', 'pfx', 'jks'] } },
                visibleWhen: { field: 'pluginConfig.ssl.clientAuth', equals: true },
              },
              {
                name: 'pluginConfig.ssl.truststorePassword',
                label: 'Truststore Password',
                type: 'password',
                visibleWhen: { field: 'pluginConfig.ssl.clientAuth', equals: true },
              },
              {
                name: 'pluginConfig.ssl.truststoreType',
                label: 'Truststore Type',
                type: 'select',
                defaultValue: 'PKCS12',
                options: [
                  { value: 'PKCS12', label: 'PKCS12 (recommended)' },
                  { value: 'JKS', label: 'JKS' },
                ],
                visibleWhen: { field: 'pluginConfig.ssl.clientAuth', equals: true },
              },
            ],
          } as FormSchema['sections'][number]] : []),
      ],
    };

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'init',
      formId: 'jsm.serverForm',
      mode,
      schema,
      data: record ? serverConfigToFormData(record.config) : undefined,
      targetId: record?.serverId,
      targetWorkspaceFolderUri: record?.workspaceFolderUri,
    });
  }

  private buildTemplateSchema(): FormSchema {
    const supportedTypes = this.deps.pluginRegistry.getSupportedTypes();
    const typeOptions = supportedTypes.map(type => ({
      value: type,
      label: this.deps.pluginRegistry.get(type)?.getUIMetadata().displayName ?? type,
    }));

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
            {
              name: 'scope',
              label: 'Scope',
              type: 'select',
              required: true,
              defaultValue: 'workspace',
              options: [
                { value: 'workspace', label: 'Workspace' },
                { value: 'global', label: 'Global' },
              ],
            },
            {
              name: 'pluginType',
              label: 'Server Type',
              type: 'select',
              required: true,
              defaultValue: typeOptions[0]?.value ?? 'tomcat',
              options: typeOptions,
            },
          ],
        },
        {
          id: 'defaults',
          title: 'Defaults',
          fields: [
            {
              name: 'runtime.homePath',
              label: 'Runtime Home',
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
              label: 'JVM Arguments',
              type: 'tags',
              helpText: 'Optional default JVM arguments for servers created from this template.',
            },
            {
              name: 'debug.bind',
              label: 'Debug Bind',
              type: 'select',
              defaultValue: '127.0.0.1',
              options: [
                { value: '127.0.0.1', label: '127.0.0.1' },
                { value: 'localhost', label: 'localhost' },
                { value: '::1', label: '::1' },
              ],
            },
            {
              name: 'hooks',
              label: 'Hooks',
              type: 'hooks',
              defaultValue: [],
              helpText: 'Default hooks applied to servers created from this template.',
              hookOptions: {
                taskOptions: this.hookTaskOptions,
              },
            },
          ],
        },
        {
          id: 'ssl',
          title: 'SSL/TLS',
          collapsible: true,
          fields: [
            {
              name: 'pluginConfig.ssl.enabled',
              label: 'Enable SSL/HTTPS',
              type: 'checkbox',
              defaultValue: false,
              visibleWhen: { field: 'pluginType', equals: 'tomcat' },
            },
            {
              name: 'pluginConfig.ssl.port',
              label: 'HTTPS Port',
              type: 'port',
              defaultValue: 8443,
              validation: { min: 1, max: 65535 },
              visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
            },
            {
              name: 'pluginConfig.ssl.keystorePath',
              label: 'Keystore File',
              type: 'path',
              browse: { kind: 'file', filters: { Keystore: ['p12', 'pfx', 'jks'] } },
              visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
            },
            {
              name: 'pluginConfig.ssl.keystorePassword',
              label: 'Keystore Password',
              type: 'password',
              visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
            },
            {
              name: 'pluginConfig.ssl.keystoreType',
              label: 'Keystore Type',
              type: 'select',
              defaultValue: 'PKCS12',
              options: [
                { value: 'PKCS12', label: 'PKCS12 (recommended)' },
                { value: 'JKS', label: 'JKS' },
              ],
              visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
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
    this.currentFormTargetWorkspaceFolderUri = undefined;

    const record = mode === 'edit' && templateId
      ? this.deps.templateService.listScoped().find(item => item.template.id === templateId)
      : undefined;
    this.currentFormTargetScope = record?.scope ?? 'workspace';

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'init',
      formId: 'jsm.templateForm',
      mode,
      schema: this.buildTemplateSchema(),
      data: record
        ? {
          name: record.template.name,
          description: record.template.description,
          scope: record.scope,
          pluginType: record.template.pluginType,
          ...templateToServerFormData(record.template),
        }
        : undefined,
      targetId: record?.template.id,
      targetScope: record?.scope ?? 'workspace',
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

  private async handleJavaDetect(): Promise<void> {
    const candidates: Array<{ label: string; description: string; path: string }> = [];

    // 1. Check JAVA_HOME env var
    const envJavaHome = process.env.JAVA_HOME;
    if (envJavaHome?.trim()) {
      const javaExe = process.platform === 'win32' ? 'java.exe' : 'java';
      const javaPath = require('path').join(envJavaHome.trim(), 'bin', javaExe);
      try {
        await require('fs/promises').access(javaPath);
        candidates.push({
          label: `$(environment) JAVA_HOME`,
          description: envJavaHome.trim(),
          path: envJavaHome.trim(),
        });
      } catch {
        // JAVA_HOME set but invalid
      }
    }

    // 2. Check common paths based on platform
    const fs = require('fs/promises');
    const pathModule = require('path');
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    const commonPaths: string[] = [];
    if (isMac) {
      commonPaths.push(
        '/Library/Java/JavaVirtualMachines',
        '/opt/homebrew/opt',
        '/usr/local/opt',
      );
    } else if (isWindows) {
      commonPaths.push(
        'C:\\Program Files\\Java',
        'C:\\Program Files\\Eclipse Adoptium',
        'C:\\Program Files\\Microsoft',
      );
    } else {
      commonPaths.push(
        '/usr/lib/jvm',
        '/usr/java',
        '/opt/java',
        '/snap/java',
      );
    }

    for (const basePath of commonPaths) {
      try {
        const entries = await fs.readdir(basePath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          let javaHome: string;
          if (isMac && basePath.includes('JavaVirtualMachines')) {
            javaHome = pathModule.join(basePath, entry.name, 'Contents', 'Home');
          } else if (basePath.includes('opt') || basePath.includes('local')) {
            javaHome = pathModule.join(basePath, entry.name, 'libexec', 'openjdk.jdk', 'Contents', 'Home');
          } else {
            javaHome = pathModule.join(basePath, entry.name);
          }
          const javaExe = isWindows ? 'java.exe' : 'java';
          const javaPath = pathModule.join(javaHome, 'bin', javaExe);
          try {
            await fs.access(javaPath);
            if (!candidates.some(c => c.path === javaHome)) {
              candidates.push({
                label: `$(folder) ${entry.name}`,
                description: javaHome,
                path: javaHome,
              });
            }
          } catch {
            // No java executable in this path
          }
        }
      } catch {
        // Directory doesn't exist or not readable
      }
    }

    if (candidates.length === 0) {
      vscode.window.showInformationMessage('No Java installations found. Set JAVA_HOME manually.');
      return;
    }

    const selection = await vscode.window.showQuickPick(candidates, {
      placeHolder: 'Select a Java installation',
    });

    if (selection) {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'browsed',
        field: 'javaHome',
        path: selection.path,
      });
    }
  }

  private async handleTemplateCreateServer(templateId?: string): Promise<CommandExecutionResult> {
    if (!templateId) {
      return { ok: false, message: 'Template not found.' };
    }

    const template = this.deps.templateService.get(templateId);
    if (!template) {
      this.postError(`Template not found: ${templateId}`);
      return { ok: false, message: `Template not found: ${templateId}` };
    }

    this.navigate({ type: 'new-server', templateId: template.id });
    return { ok: true };
  }

  private async handleTemplateDelete(templateId?: string): Promise<CommandExecutionResult> {
    if (!templateId) {
      return { ok: false, message: 'Template not found.' };
    }

    const entry = this.deps.templateService.listScoped().find(item => item.template.id === templateId);
    if (!entry) {
      return { ok: false, message: 'Template not found.' };
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Delete template "${entry.template.name}" from ${entry.scope}?`,
      { modal: true },
      'Delete',
    );
    if (confirmation !== 'Delete') {
      return { ok: false, message: 'Template deletion cancelled.' };
    }

    const result = await this.deps.templateService.delete(entry.template.id, entry.scope);
    if (!result.ok) {
      this.postError(result.error.message);
      return { ok: false, message: result.error.message };
    }

    this.syncState();
    this.navigate({ type: 'welcome' });
    return { ok: true };
  }

  private async handleServerFormSubmit(): Promise<void> {
    if (this.currentFormId !== 'jsm.serverForm') {
      this.postError('Submit is not supported in the current view.');
      return;
    }

    const lastSubmittedData = this.lastSubmittedFormData;
    if (!lastSubmittedData) {
      this.postError('No form data received.');
      return;
    }

    const errors = validateServerForm(lastSubmittedData);
    if (errors.length > 0) {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'validationErrors',
        errors,
      });
      return;
    }

    if (!this.currentFormTargetId || !this.currentFormTargetWorkspaceFolderUri) {
      this.postError('Server target not found.');
      return;
    }

    const record = this.deps.workspaceRegistry.getAllServers().find(item =>
      item.serverId === this.currentFormTargetId
      && item.workspaceFolderUri === this.currentFormTargetWorkspaceFolderUri,
    );
    if (!record) {
      this.postError('Server not found.');
      return;
    }

    const result = await this.deps.workspaceRegistry.updateServer(
      {
        workspaceFolderUri: record.workspaceFolderUri,
        serverId: record.serverId,
      },
      formDataToServerConfig(lastSubmittedData, record.config),
    );
    this.lastSubmittedFormData = undefined;

    if (!result.ok) {
      this.postError(result.error.message);
      return;
    }

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

    const validationErrors: Array<{ field: string; message: string }> = [];
    if (String(lastSubmittedData['name'] ?? '').trim().length === 0) {
      validationErrors.push({
        field: 'name',
        message: 'Template name is required.',
      });
    }
    if (validationErrors.length > 0) {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'validationErrors',
        errors: validationErrors,
      });
      return;
    }

    const templateDraft = formDataToTemplateDraft(lastSubmittedData, {
      fallbackScope: existingEntry?.scope ?? this.currentFormTargetScope ?? 'workspace',
      fallbackPluginType: existingEntry?.template.pluginType ?? 'tomcat',
    });
    const template = templateDraftToTemplate({
      id: existingEntry?.template.id ?? uuid(),
      draft: templateDraft,
    });

    const result = await this.deps.templateService.save(template, templateDraft.scope);
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

  private async handleSettingsSave(settings: unknown): Promise<CommandExecutionResult> {
    if (!settings || typeof settings !== 'object') {
      this.postError('Invalid settings data');
      return { ok: false, message: 'Invalid settings data' };
    }

    const trustResult = requireWorkspaceTrust(this.deps.trustGate, 'modify JSM settings');
    if (!trustResult.ok) {
      this.postError(trustResult.error.message);
      return { ok: false, message: trustResult.error.message };
    }

    try {
      const config = vscode.workspace.getConfiguration('jsm');
      const s = settings as Record<string, unknown>;

      if ('defaultHttpPort' in s) {
        await config.update('defaults.httpPort', s.defaultHttpPort, vscode.ConfigurationTarget.Global);
      }
      if ('defaultDebugPort' in s) {
        await config.update('defaults.debugPort', s.defaultDebugPort, vscode.ConfigurationTarget.Global);
      }
      if ('defaultJavaHome' in s) {
        await config.update('defaults.javaHome', s.defaultJavaHome, vscode.ConfigurationTarget.Global);
      }
      if ('showStatusInSidebar' in s) {
        await config.update('ui.showStatusInSidebar', s.showStatusInSidebar, vscode.ConfigurationTarget.Global);
      }

      this.deps.logger.info('Settings saved successfully');
      this.syncState();
      return { ok: true };
    } catch (e) {
      this.deps.logger.error('Error saving settings', e);
      const message = `Error saving settings: ${String(e)}`;
      this.postError(message);
      return { ok: false, message };
    }
  }

  private syncState(): void {
    if (!this.panel) return;

    const servers = this.deps.workspaceRegistry.getAllServers().map(r => ({
      serverKey: r.serverKey,
      config: r.config,
      workspaceFolderUri: r.workspaceFolderUri,
      workspaceFolderName: r.workspaceFolderName,
    }));

    const runtimeStates: Record<string, unknown> = {};
    for (const server of servers) {
      const runtime = this.deps.lifecycle.getRuntime(server.serverKey);
      if (runtime) {
        runtimeStates[server.serverKey] = runtime.getState();
      }
    }

    // Gather deployment states
    const deploymentStates: Record<string, Record<string, string>> = {};
    if (this.deps.deployService) {
      for (const server of servers) {
        const serverKey = server.serverKey;
        const deps: Record<string, string> = {};
        for (const dep of server.config.deployments || []) {
          try {
            deps[dep.id] = this.deps.deployService.getDeploymentState(serverKey, dep.id);
          } catch {
            deps[dep.id] = 'undeployed';
          }
        }
        if (Object.keys(deps).length > 0) {
          deploymentStates[serverKey] = deps;
        }
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

    const config = vscode.workspace.getConfiguration('jsm');
    const settings = {
      defaultHttpPort: config.get('defaults.httpPort', 8080),
      defaultDebugPort: config.get('defaults.debugPort', 5005),
      defaultJavaHome: config.get('defaults.javaHome', ''),
      showStatusInSidebar: config.get('ui.showStatusInSidebar', true),
    };

    this.panelLog.debug('syncState.pushed', {
      serverCount: servers.length,
      serverIds: servers.map(s => s.config.id),
    });

    const workspaceTrusted = this.deps.trustGate?.isTrusted() ?? vscode.workspace.isTrusted;

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'syncState',
      servers,
      runtimeStates,
      deploymentStates,
      templates,
      capabilities,
      workspaceFolders,
      settings,
      workspaceTrusted,
    });
  }

  private normalizeCommandResult(result: unknown): CommandExecutionResult {
    if (
      typeof result === 'object'
      && result !== null
      && 'ok' in result
      && typeof (result as Record<string, unknown>).ok === 'boolean'
    ) {
      const typed = result as Record<string, unknown>;
      return {
        ok: typed.ok as boolean,
        message: typeof typed.message === 'string' ? typed.message : undefined,
        data: typeof typed.data === 'object' && typed.data !== null
          ? typed.data as Record<string, unknown>
          : undefined,
      };
    }

    return { ok: true };
  }

  private postCommandResult(requestId: string, result: CommandExecutionResult): void {
    this.panelLog.debug('commandResult.postMessage', {
      requestId,
      ok: result.ok,
      message: result.message,
      dataKeys: result.data ? Object.keys(result.data) : undefined,
    });
    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'commandResult',
      requestId,
      ok: result.ok,
      message: result.message,
      data: result.data,
    });
  }

  private navigate(target: DashboardNavigationTarget): void {
    const normalized = normalizeDashboardNavigationTarget(target);
    if (!this.isWebviewReady) {
      this.pendingNavigationTarget = normalized;
      return;
    }

    this.panelLog.debug('navigate.postMessage', {
      type: normalized.type,
      globalTab: normalized.globalTab,
    });
    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'navigate',
      target: normalized,
    });
    this.pendingNavigationTarget = undefined;
  }

  private flushPendingNavigation(): void {
    if (!this.pendingNavigationTarget) {
      return;
    }

    this.navigate(this.pendingNavigationTarget);
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

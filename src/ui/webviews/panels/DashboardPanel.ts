import * as vscode from 'vscode';
import {
  serverConfigToFormData,
  templateToServerFormData,
  validateHookList,
} from '@core/authoring';
import type { Logger } from '@core/types';
import type { DashboardNavigationTarget, HostToWebview, WebviewToHost } from '../protocol';
import { WEBVIEW_PROTOCOL_VERSION } from '../protocol';
import { areHookTaskOptionsEqual, fetchHookTaskOptions, type HookTaskOption } from '../hookTaskOptions';
import { requireWorkspaceTrust } from '@core/policy';
import { normalizeDashboardNavigationTarget } from '../dashboardNavigation';
import type { CommandExecutionResult, DashboardPanelDeps } from './dashboard/dashboardPanelTypes';
import { buildDashboardPanelHtml } from './dashboard/buildDashboardPanelHtml';
import { buildServerFormSchema, type ServerFormUiMeta } from './dashboard/buildServerFormSchema';
import { buildTemplateFormSchema } from './dashboard/buildTemplateFormSchema';
import { collectJavaInstallationCandidates } from './dashboard/javaInstallationCandidates';
import { buildDashboardSyncStatePayload } from './dashboard/buildDashboardSyncStatePayload';
import { redactDashboardSecrets } from './dashboard/redactDashboardSecrets';
import {
  deleteServerWithConfirm,
  deleteTemplateWithConfirm,
  saveTemplateFromWebview,
} from './dashboard/dashboardPanelTemplateCrud';
import {
  submitServerConfigForm,
  submitTemplateConfigForm,
} from './dashboard/dashboardPanelFormSubmit';

export type { DashboardPanelDeps } from './dashboard/dashboardPanelTypes';

type EditableTemplateScope = 'global' | 'workspace';

function isEditableTemplateScope(scope: 'global' | 'workspace' | 'gallery'): scope is EditableTemplateScope {
  return scope === 'global' || scope === 'workspace';
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
    this.registerBusListeners();
  }

  private registerBusListeners(): void {
    const inventorySync = (reason: string, extra?: Record<string, unknown>) => {
      this.panelLog.debug('syncState.trigger', { reason, ...extra });
      this.syncState();
    };

    this.disposables.push(
      this.deps.bus.on('ServerStateChanged', (e) => {
        this.postMessage({
          v: WEBVIEW_PROTOCOL_VERSION,
          command: 'serverStateChanged',
          serverKey: e.serverId,
          state: this.deps.lifecycle.getRuntime(e.serverId)?.getState(),
        });
      }),
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
      }),
      this.deps.bus.on('ServerAdded', e => {
        inventorySync('ServerAdded', { serverId: e.serverId, workspaceFolderUri: e.workspaceFolderUri });
      }),
      this.deps.bus.on('ServerDeleted', e => {
        inventorySync('ServerDeleted', { serverId: e.serverId, workspaceFolderUri: e.workspaceFolderUri });
      }),
      this.deps.bus.on('ServerUpdated', e => {
        inventorySync('ServerUpdated', { serverId: e.serverId, workspaceFolderUri: e.workspaceFolderUri });
      }),
      this.deps.bus.on('DeploymentAdded', e => {
        inventorySync('DeploymentAdded', {
          serverId: e.serverId,
          deploymentId: e.deploymentId,
          workspaceFolderUri: e.workspaceFolderUri,
        });
      }),
      this.deps.bus.on('DeploymentUpdated', e => {
        inventorySync('DeploymentUpdated', {
          serverId: e.serverId,
          deploymentId: e.deploymentId,
          workspaceFolderUri: e.workspaceFolderUri,
        });
      }),
      this.deps.bus.on('DeploymentRemoved', e => {
        inventorySync('DeploymentRemoved', {
          serverId: e.serverId,
          deploymentId: e.deploymentId,
          workspaceFolderUri: e.workspaceFolderUri,
        });
      }),
      this.deps.bus.on('DeploymentStateChanged', e => {
        this.postMessage({
          v: WEBVIEW_PROTOCOL_VERSION,
          command: 'deploymentStateChanged',
          serverKey: e.serverId,
          deploymentId: e.deploymentId,
          state: e.state,
        });
      }),
    );
  }

  private resetFormSession(): void {
    this.currentFormId = undefined;
    this.currentFormMode = undefined;
    this.currentFormTargetId = undefined;
    this.currentFormTargetWorkspaceFolderUri = undefined;
    this.currentFormTargetScope = undefined;
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
      const panel = this.createPanel();
      panel.reveal(vscode.ViewColumn.One);
    }
  }

  private createPanel(): vscode.WebviewPanel {
    const distWebview = vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview');

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Java Server Manager',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [distWebview],
        retainContextWhenHidden: true, // Keep SPA state when switching tabs
      }
    );
    this.panel = panel;

    panel.webview.html = buildDashboardPanelHtml(panel.webview, distWebview);

    panel.webview.onDidReceiveMessage(
      async (raw: unknown) => {
        if (!this.isValidProtocolMessage(raw)) return;
        await this.handleMessage(raw);
      },
      undefined,
      this.disposables
    );

    panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.isWebviewReady = false;
      },
      undefined,
      this.disposables
    );

    void this.refreshHookTaskOptions();
    return panel;
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

  private handleReadyMessage(): void {
    this.isWebviewReady = true;
    this.resetFormSession();
    this.syncState();
    this.flushPendingNavigation();
    this.pushHookTaskOptions();
    void this.refreshHookTaskOptions();
  }

  private async handleSubmitMessage(
    msg: Extract<WebviewToHost, { command: 'submit' }>,
  ): Promise<void> {
    // Store last submitted data so we can persist it when the host handler runs.
    this.lastSubmittedFormData = msg.data;

    try {
      if (this.currentFormId === 'jsm.serverForm') {
        await this.handleServerFormSubmit();
      } else if (this.currentFormId === 'jsm.templateForm') {
        await this.handleTemplateFormSubmit();
      } else {
        this.postError('Submit is not supported in the current view.');
      }
    } catch (e) {
      this.deps.logger.error('[DashboardPanel] Form submit failed', e);
      this.postError(`Save failed: ${String(e)}`);
    } finally {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'submitFinished',
      });
    }
  }

  private async handleMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.command) {
      case 'ready':
        this.handleReadyMessage();
        break;

      case 'executeCommand': {
        let commandResult: CommandExecutionResult | undefined;
        try {
          commandResult = await this.handleExecuteCommandMessage(msg);
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
        await this.handleSubmitMessage(msg);
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
        this.resetFormSession();
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
        if (msg.actionId === 'autodiscover' && msg.field === 'javaHome') {
          await this.handleJavaDetect();
        }
        break;

      case 'deleteServer':
        await deleteServerWithConfirm(
          this.deps,
          m => this.postError(m),
          () => this.syncState(),
          msg.serverId,
          msg.workspaceFolderUri,
        );
        break;

      case 'saveTemplate':
        await saveTemplateFromWebview(
          this.deps,
          m => this.postError(m),
          () => this.syncState(),
          msg.template,
          msg.scope,
        );
        break;

      case 'deleteTemplate': {
        const result = await deleteTemplateWithConfirm(
          this.deps,
          m => this.postError(m),
          () => this.syncState(),
          msg.templateId,
          msg.scope,
        );
        if (result.ok) {
          this.navigate({ type: 'templates-index', globalTab: 'templates' });
        }
        break;
      }

      default:
        this.deps.logger.warn(`[DashboardPanel] Unhandled message type: ${(msg as any).command}`);
        break;
    }
  }

  private async handleExecuteCommandMessage(
    msg: Extract<WebviewToHost, { command: 'executeCommand' }>,
  ): Promise<CommandExecutionResult | undefined> {
    const guard = this.validateExecuteCommandRequest(msg);
    if (!guard.ok) {
      return guard;
    }

    if (msg.id === 'jsm.internal.requestServerSchema') {
      const [mode, serverId, workspaceFolderUri] = (msg.args || []) as ['edit' | 'create', string?, string?];
      await this.handleSchemaRequest(mode, serverId, workspaceFolderUri);
      return undefined;
    }

    if (msg.id === 'jsm.internal.requestTemplateSchema') {
      const [mode, templateId] = (msg.args || []) as ['edit' | 'create', string?];
      await this.handleTemplateSchemaRequest(mode, templateId);
      return undefined;
    }

    if (msg.id === 'jsm.server.autodiscover') {
      await this.handleAutodiscover();
      return undefined;
    }

    if (msg.id === 'jsm.java.detect') {
      const [targetField] = (msg.args || []) as [string?];
      await this.handleJavaDetect(targetField);
      return undefined;
    }

    if (msg.id === 'jsm.template.createServer') {
      const [templateId] = (msg.args || []) as [string?];
      return this.handleTemplateCreateServer(templateId);
    }

    if (msg.id === 'jsm.template.delete') {
      const [templateId] = (msg.args || []) as [string?];
      return this.handleTemplateDelete(templateId);
    }

    if (msg.id === 'jsm.settings.save') {
      return this.handleSettingsSave(msg.args?.[0]);
    }

    if (msg.id === 'jsm.server.add') {
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
      const result = this.normalizeCommandResult(raw);

      this.panelLog.debug('command.jsm.server.add.after', {
        requestId: msg.requestId,
        ok: result.ok,
        message: result.message,
        dataServerId: result.data?.serverId,
      });
      return result;
    }

    return this.normalizeCommandResult(
      await vscode.commands.executeCommand(msg.id, ...(msg.args || [])),
    );
  }

  private validateExecuteCommandRequest(
    msg: Extract<WebviewToHost, { command: 'executeCommand' }>,
  ): CommandExecutionResult {
    const args = msg.args ?? [];
    switch (msg.id) {
      case 'jsm.internal.requestServerSchema':
        return this.validateTuple(args, value =>
          (value.length === 1 || value.length === 2 || value.length === 3)
          && (value[0] === 'create' || value[0] === 'edit')
          && (value[1] === undefined || typeof value[1] === 'string')
          && (value[2] === undefined || typeof value[2] === 'string'));

      case 'jsm.internal.requestTemplateSchema':
        return this.validateTuple(args, value =>
          (value.length === 1 || value.length === 2)
          && (value[0] === 'create' || value[0] === 'edit')
          && (value[1] === undefined || typeof value[1] === 'string'));

      case 'jsm.server.autodiscover':
      case 'jsm.server.import':
      case 'jsm.server.export':
      case 'jsm.view.refresh':
        return this.validateTuple(args, value => value.length === 0);

      case 'jsm.java.detect':
        return this.validateTuple(args, value =>
          value.length === 0 || (value.length === 1 && typeof value[0] === 'string'));

      case 'jsm.port.suggest':
        return this.validateTuple(args, value =>
          value.length === 1 && this.isPortSuggestPayload(value[0]));

      case 'jsm.template.createServer':
      case 'jsm.template.delete':
        return this.validateTuple(args, value =>
          value.length === 1 && typeof value[0] === 'string' && value[0].trim().length > 0);

      case 'jsm.settings.save':
        return this.validateTuple(args, value =>
          value.length === 1 && this.isSettingsPayload(value[0]));

      case 'jsm.server.add':
        return this.validateTuple(args, value =>
          value.length === 0 || (value.length === 1 && this.isServerAddPayload(value[0])));

      case 'jsm.server.showLogs':
      case 'jsm.server.doctor':
      case 'jsm.server.startRun':
      case 'jsm.server.stop':
        return this.validateTuple(args, value =>
          value.length === 1 && this.isServerCommandArg(value[0]));

      case 'jsm.hook.test':
        return this.validateTuple(args, value =>
          value.length === 1 && this.isHookTestCommandArg(value[0]));

      case 'jsm.deployment.add':
        return this.validateTuple(args, value =>
          value.length === 1 && this.isDeploymentDraftCommandArg(value[0]));

      case 'jsm.deployment.edit':
        return this.validateTuple(args, value =>
          value.length === 1
          && this.isDeploymentDraftCommandArg(value[0])
          && this.isDeploymentCommandArg(value[0]));

      case 'jsm.deployment.redeploy':
      case 'jsm.deployment.rollback':
      case 'jsm.deployment.openLogs':
      case 'jsm.deployment.revealSource':
      case 'jsm.deployment.remove':
        return this.validateTuple(args, value =>
          value.length === 1 && this.isDeploymentCommandArg(value[0]));

      default:
        return {
          ok: false,
          message: `Dashboard command '${msg.id}' is not available.`,
        };
    }
  }

  private validateTuple(
    args: unknown[],
    predicate: (args: unknown[]) => boolean,
  ): CommandExecutionResult {
    if (predicate(args)) {
      return { ok: true };
    }
    return {
      ok: false,
      message: 'Invalid arguments for dashboard command.',
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isServerCommandArg(value: unknown): boolean {
    if (!this.isRecord(value)) {
      return false;
    }
    return this.isNonEmptyString(value['serverId'])
      && (
        value['workspaceFolderUri'] === undefined
        || this.isNonEmptyString(value['workspaceFolderUri'])
      )
      && (
        value['serverKey'] === undefined
        || this.isNonEmptyString(value['serverKey'])
      )
      && (
        value['workspaceFolderName'] === undefined
        || typeof value['workspaceFolderName'] === 'string'
      );
  }

  private isServerAddPayload(value: unknown): boolean {
    if (!this.isRecord(value)) {
      return false;
    }
    return this.isNonEmptyString(value['workspaceFolderUri'])
      && this.isRecord(value['draft']);
  }

  private isDeploymentCommandArg(value: unknown): boolean {
    if (!this.isServerCommandArg(value) || !this.isRecord(value)) {
      return false;
    }
    return this.isNonEmptyString(value['deploymentId']);
  }

  private isDeploymentDraftCommandArg(value: unknown): boolean {
    if (!this.isServerCommandArg(value) || !this.isRecord(value)) {
      return false;
    }
    return this.isRecord(value['draft']);
  }

  private isHookTestCommandArg(value: unknown): boolean {
    if (!this.isServerCommandArg(value) || !this.isRecord(value)) {
      return false;
    }
    const hook = value['hook'];
    if (!this.isRecord(hook)) {
      return false;
    }
    if (
      value['targetDeploymentId'] !== undefined
      && !this.isNonEmptyString(value['targetDeploymentId'])
    ) {
      return false;
    }
    return validateHookList([hook], 'hook').length === 0;
  }

  private isPortSuggestPayload(value: unknown): boolean {
    if (!this.isRecord(value)) {
      return false;
    }
    const port = value['port'];
    const normalizedPort = typeof port === 'number'
      ? port
      : typeof port === 'string' && port.trim().length > 0
        ? Number(port)
        : NaN;
    if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
      return false;
    }
    return (
      value['host'] === undefined || typeof value['host'] === 'string'
    ) && (
      value['field'] === undefined || typeof value['field'] === 'string'
    ) && (
      value['maxTries'] === undefined
      || (Number.isInteger(value['maxTries']) && Number(value['maxTries']) > 0)
    );
  }

  private isSettingsPayload(value: unknown): boolean {
    if (!this.isRecord(value)) {
      return false;
    }
    const allowedKeys = new Set([
      'defaultHttpPort',
      'defaultDebugPort',
      'defaultJavaHome',
      'showStatusInSidebar',
      'localTelemetryEnabled',
    ]);
    return Object.entries(value).every(([key, item]) => {
      if (!allowedKeys.has(key)) {
        return false;
      }
      if (key === 'defaultHttpPort' || key === 'defaultDebugPort') {
        return Number.isInteger(item) && Number(item) >= 1 && Number(item) <= 65535;
      }
      if (key === 'defaultJavaHome') {
        return typeof item === 'string';
      }
      return typeof item === 'boolean';
    });
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
    const plugin = this.deps.pluginRegistry.get(serverType);
    const jsmConfig = vscode.workspace.getConfiguration('jsm');

    const schema = buildServerFormSchema({
      mode,
      uiMeta: plugin?.getUIMetadata() as ServerFormUiMeta | undefined,
      supportsSsl: plugin?.getCapabilities()?.supportsSsl,
      hookTaskOptions: this.hookTaskOptions,
      defaultHttpPort: jsmConfig.get('defaults.httpPort', 8080),
    });

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'init',
      formId: 'jsm.serverForm',
      mode,
      schema,
      data: record ? redactDashboardSecrets(serverConfigToFormData(record.config)) : undefined,
      targetId: record?.serverId,
      targetWorkspaceFolderUri: record?.workspaceFolderUri,
    });
  }

  private async handleTemplateSchemaRequest(mode: 'create' | 'edit', templateId?: string): Promise<void> {
    this.currentFormId = 'jsm.templateForm';
    this.currentFormMode = mode;
    this.currentFormTargetId = templateId;
    this.currentFormTargetWorkspaceFolderUri = undefined;

    const record = mode === 'edit' && templateId
      ? this.deps.templateService.listScoped().find(item => item.template.id === templateId)
      : undefined;
    if (mode === 'edit') {
      if (!record) {
        this.resetFormSession();
        this.postError(templateId ? `Template not found: ${templateId}` : 'Template not found.');
        return;
      }
      if (!isEditableTemplateScope(record.scope)) {
        this.resetFormSession();
        this.postError('Built-in gallery templates cannot be edited.');
        return;
      }
    }

    const targetScope: EditableTemplateScope = record && isEditableTemplateScope(record.scope)
      ? record.scope
      : 'workspace';
    this.currentFormTargetScope = targetScope;

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'init',
      formId: 'jsm.templateForm',
      mode,
      schema: buildTemplateFormSchema(this.deps.pluginRegistry, this.hookTaskOptions),
      data: record
        ? {
          name: record.template.name,
          description: record.template.description,
          scope: targetScope,
          pluginType: record.template.pluginType,
          ...templateToServerFormData(record.template),
        }
        : undefined,
      targetId: record?.template.id,
      targetScope,
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

  private async handleJavaDetect(targetField: string = 'javaHome'): Promise<void> {
    const candidates = await collectJavaInstallationCandidates();
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
        field: targetField,
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
    if (!isEditableTemplateScope(entry.scope)) {
      return { ok: false, message: 'Built-in gallery templates cannot be deleted.' };
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
    this.navigate({ type: 'templates-index', globalTab: 'templates' });
    return { ok: true };
  }

  private async handleServerFormSubmit(): Promise<void> {
    if (this.currentFormId !== 'jsm.serverForm') {
      this.postError('Submit is not supported in the current view.');
      return;
    }

    await submitServerConfigForm({
      deps: this.deps,
      lastSubmittedData: this.lastSubmittedFormData,
      currentFormTargetId: this.currentFormTargetId,
      currentFormTargetWorkspaceFolderUri: this.currentFormTargetWorkspaceFolderUri,
      postError: m => this.postError(m),
      postMessage: m => this.postMessage(m),
      syncState: () => this.syncState(),
      onClearLastSubmitted: () => {
        this.lastSubmittedFormData = undefined;
      },
    });
  }

  private async handleTemplateFormSubmit(): Promise<void> {
    if (!this.currentFormId || this.currentFormId !== 'jsm.templateForm') {
      this.postError('Submit is not supported in the current view.');
      return;
    }

    const outcome = await submitTemplateConfigForm({
      deps: this.deps,
      lastSubmittedData: this.lastSubmittedFormData,
      currentFormMode: this.currentFormMode,
      currentFormTargetId: this.currentFormTargetId,
      currentFormTargetScope: this.currentFormTargetScope,
      postError: m => this.postError(m),
      postMessage: m => this.postMessage(m),
      syncState: () => this.syncState(),
      onClearLastSubmitted: () => {
        this.lastSubmittedFormData = undefined;
      },
    });

    if (outcome.ok) {
      this.resetFormSession();
      this.navigate({ type: 'template', id: outcome.templateId, globalTab: 'templates' });
    }
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
      if ('localTelemetryEnabled' in s) {
        await config.update('telemetry.localMetrics.enabled', s.localTelemetryEnabled, vscode.ConfigurationTarget.Global);
        if (s.localTelemetryEnabled === false) {
          await this.deps.localTelemetry?.clear();
        }
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

    try {
      const payload = buildDashboardSyncStatePayload(this.deps);

      this.panelLog.debug('syncState.pushed', {
        serverCount: payload.servers.length,
        serverIds: payload.servers.map(s => (s.config as { id?: string }).id),
      });

      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'syncState',
        ...payload,
      });
    } catch (e) {
      this.deps.logger.error('[DashboardPanel] syncState failed', e);
      this.postError(`Failed to refresh dashboard state: ${String(e)}`);
    }
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

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

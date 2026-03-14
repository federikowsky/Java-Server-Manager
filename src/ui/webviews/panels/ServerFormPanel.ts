import * as vscode from 'vscode';
import type { WorkspaceServerLocator, WorkspaceServiceRegistry } from '@app/config';
import type { CreateServerRequest } from '@app/server';
import type { Logger } from '@core/types';
import type { ServerTemplate } from '@core/types';
import type {
  FormSchema,
  FormFieldDef,
  WebviewToHost,
  FieldError,
} from '../protocol';
import { WEBVIEW_PROTOCOL_VERSION } from '../protocol';
import { normalizeHookList, validateHookList } from '../hookForm';
import { areHookTaskOptionsEqual, fetchHookTaskOptions, type HookTaskOption } from '../hookTaskOptions';
import { BaseFormPanel } from './BaseFormPanel';

import type { TemplateService } from '@app/templates/TemplateService';
import type { ServerDiscoveryService } from '@app/server/ServerDiscoveryService';

// ── Dependency contract ─────────────────────────────────────────────────────

export interface ServerFormPanelDeps {
  extensionUri: vscode.Uri;
  workspaceRegistry?: WorkspaceServiceRegistry;
  configService?: {
    getServer(serverId: string): any;
    updateServer(config: any): Promise<any>;
  };
  provisioningService?: {
    createServer(request: CreateServerRequest): Promise<any>;
  };
  templateService?: TemplateService;
  discoveryService?: ServerDiscoveryService;
  logger: Logger;
}

const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_DEBUG_PORT = 5005;

// ── Server Form Schema (§7.7) ──────────────────────────────────────────────

function serverFormSchema(mode: 'create' | 'edit', hookTaskOptions: HookTaskOption[]): FormSchema {
  const identityFields: FormFieldDef[] = [
    {
      name: 'name',
      label: 'Server Name',
      type: 'text',
      required: true,
      placeholder: 'My Tomcat',
    },
    {
      name: 'ports.http',
      label: 'HTTP Port',
      type: 'port',
      required: true,
      defaultValue: DEFAULT_HTTP_PORT,
      validation: { min: 1, max: 65535 },
    },
  ];

  return {
    title: mode === 'create' ? 'Add Server' : 'Edit Server',
    sections: [
      {
        id: 'runtime',
        title: 'Runtime',
        fields: [
          {
            name: 'runtime.homePath',
            label: 'Server Home (CATALINA_HOME)',
            type: 'path',
            required: true,
            browse: { kind: 'directory' },
            actionButtons: [
              { id: 'autodiscover', icon: 'search', title: 'Autodiscover Server Installation' },
            ],
            helpText: 'Absolute path to the Tomcat installation directory.',
          },
        ],
      },
      {
        id: 'identity',
        title: 'Server Identity',
        fields: identityFields,
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
            helpText: 'Configure server hooks as terminal commands or VS Code tasks. New hooks start with a default Hook-N identifier used in logs and diagnostics.',
            hookOptions: {
              taskOptions: hookTaskOptions,
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
          },
          {
            name: 'pluginConfig.ssl.port',
            label: 'HTTPS Port',
            type: 'port',
            defaultValue: 8443,
            required: true,
            validation: { min: 1, max: 65535 },
            visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
          },
          {
            name: 'pluginConfig.ssl.keystorePath',
            label: 'Keystore File',
            type: 'path',
            required: true,
            browse: { kind: 'file', filters: { 'Keystore': ['p12', 'pfx', 'jks'] } },
            visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
          },
          {
            name: 'pluginConfig.ssl.keystorePassword',
            label: 'Keystore Password',
            type: 'password',
            required: true,
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
            required: true,
            browse: { kind: 'file', filters: { 'Truststore': ['p12', 'pfx', 'jks'] } },
            visibleWhen: { field: 'pluginConfig.ssl.clientAuth', equals: true },
          },
          {
            name: 'pluginConfig.ssl.truststorePassword',
            label: 'Truststore Password',
            type: 'password',
            required: true,
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
      },
    ],
  };
}

// ── Panel ───────────────────────────────────────────────────────────────────

export class ServerFormPanel extends BaseFormPanel {
  static readonly viewType = 'jsm.serverForm';

  private readonly workspaceRegistry: WorkspaceServiceRegistry;
  private readonly templateService?: TemplateService;
  private readonly discoveryService?: ServerDiscoveryService;
  private readonly logger: Logger;
  private editServerLocator: WorkspaceServerLocator | undefined;
  private createWorkspaceFolderUri: string | undefined;
  private hookTaskOptions: HookTaskOption[] = [];

  constructor(deps: ServerFormPanelDeps) {
    super(deps.extensionUri, ServerFormPanel.viewType, 'Server Configuration');
    this.workspaceRegistry = deps.workspaceRegistry ?? {
      getWorkspaceScopes: () => [{ uri: '', name: '', fsPath: '' }],
      getEntry: () => deps.configService && deps.provisioningService
        ? {
          scope: { uri: '', name: '', fsPath: '' },
          configService: deps.configService as any,
          provisioningService: deps.provisioningService as any,
          configFilePath: '',
        }
        : undefined,
      getServer: (locator: WorkspaceServerLocator) => deps.configService?.getServer(locator.serverId),
      updateServer: (_locator: WorkspaceServerLocator, config: any) => deps.configService?.updateServer(config),
      getAllServers: () => [],
    } as unknown as WorkspaceServiceRegistry;
    this.templateService = deps.templateService;
    this.discoveryService = deps.discoveryService;
    this.logger = deps.logger;
    void this.refreshHookTaskOptions();
  }

  getFormSchema(mode: 'create' | 'edit'): FormSchema {
    return serverFormSchema(mode, this.hookTaskOptions);
  }

  openCreate(workspaceFolderUri: string, initialData?: Record<string, unknown>): void {
    this.editServerLocator = undefined;
    this.createWorkspaceFolderUri = workspaceFolderUri;
    
    // Add templates to the init payload for create mode
    const templates = this.templateService?.listScoped().map(t => ({
      id: t.template.id,
      name: t.template.name,
      defaults: templateToServerFormData(t.template),
    }));

    this.show('create', initialData, templates);
    void this.refreshHookTaskOptions();
  }

  openCreateWithTemplate(workspaceFolderUri: string, template?: ServerTemplate): void {
    this.openCreate(workspaceFolderUri, template ? templateToServerFormData(template) : undefined);
  }

  openEdit(locator: WorkspaceServerLocator): void {
    this.editServerLocator = locator;
    this.createWorkspaceFolderUri = undefined;
    let data: Record<string, unknown> | undefined;

    const config = this.workspaceRegistry.getServer(locator);
    if (config) {
      data = serverConfigToFormData(config);
    }

    this.show('edit', data);
    void this.refreshHookTaskOptions();
  }

  open(mode: 'create' | 'edit', serverId?: string): void {
    if (mode === 'create') {
      const scope = this.workspaceRegistry.getWorkspaceScopes()[0];
      if (scope) {
        this.openCreateWithTemplate(scope.uri);
      }
      return;
    }

    if (!serverId) {
      this.show('edit');
      return;
    }

    const record = this.workspaceRegistry.getAllServers().find(item => item.serverId === serverId);
    const locator = record
      ? {
        workspaceFolderUri: record.workspaceFolderUri,
        serverId: record.serverId,
      }
      : {
        workspaceFolderUri: '',
        serverId,
      };

    if (this.workspaceRegistry.getServer(locator)) {
      this.openEdit(locator);
    }
  }

  // ── Form Handling ─────────────────────────────────────────────────────────

  async handleMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.command) {
      case 'ready':
        this.pushHookTaskOptions();
        break;

      case 'invokeFieldAction':
        if (msg.actionId === 'autodiscover' && msg.field === 'runtime.homePath') {
          await this.handleAutodiscover();
        }
        break;

      case 'submit':
        await this.handleSubmit(msg.data);
        break;

      case 'validate':
        this.handleValidate(msg.data);
        break;

      case 'validateField':
        this.handleFieldValidation(msg.field, msg.value);
        break;

      case 'browse':
        await this.handleBrowse(msg.field, msg.kind, msg.filters);
        break;

      case 'cancel':
        this.dispose();
        break;

      case 'loadData':
        if (this.editServerLocator) {
          const config = this.workspaceRegistry.getServer(this.editServerLocator);
          if (config) {
            this.postMessage({
              v: WEBVIEW_PROTOCOL_VERSION,
              command: 'loaded',
              data: serverConfigToFormData(config),
            });
          }
        }
        break;

      case 'requestDefaults':
        this.postMessage({
          v: WEBVIEW_PROTOCOL_VERSION,
          command: 'defaults',
          data: {
            host: '127.0.0.1',
            'ports.http': DEFAULT_HTTP_PORT,
            'debug.bind': '127.0.0.1',
          },
        });
        break;
    }
  }

  private async handleAutodiscover(): Promise<void> {
    if (!this.discoveryService) {
      vscode.window.showErrorMessage('Autodiscovery service is not available.');
      return;
    }

    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Discovering Java servers...',
      cancellable: false,
    }, async () => {
      const folders = this.workspaceRegistry.getWorkspaceScopes().map(s => s.fsPath);
      const results = await this.discoveryService!.discover(folders);

      // Filter out already registered servers
      const registeredHomes = new Set<string>();
      for (const server of this.workspaceRegistry.getAllServers()) {
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

  // ── Handlers ──────────────────────────────────────────────────────

  private async handleSubmit(data: Record<string, unknown>): Promise<void> {
    const errors = validateServerForm(data);
    if (errors.length > 0) {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'validationErrors',
        errors,
      });
      return;
    }

    try {
      if (this.editServerLocator) {
        const existing = this.workspaceRegistry.getServer(this.editServerLocator);
        if (!existing) {
          this.postMessage({
            v: WEBVIEW_PROTOCOL_VERSION,
            command: 'error',
            message: 'Server not found.',
          });
          return;
        }
        const updated = formDataToServerConfig(data, existing);
        const result = await this.workspaceRegistry.updateServer(this.editServerLocator, updated);
        if (!result.ok) {
          this.postMessage({
            v: WEBVIEW_PROTOCOL_VERSION,
            command: 'error',
            message: result.error.message,
          });
          return;
        }
      } else {
        if (this.createWorkspaceFolderUri === undefined) {
          this.postMessage({
            v: WEBVIEW_PROTOCOL_VERSION,
            command: 'error',
            message: 'Workspace not selected for server creation.',
          });
          return;
        }

        const request = formDataToCreateServerRequest(data);
        const entry = this.workspaceRegistry.getEntry(this.createWorkspaceFolderUri);
        if (!entry) {
          this.postMessage({
            v: WEBVIEW_PROTOCOL_VERSION,
            command: 'error',
            message: 'Workspace not found.',
          });
          return;
        }

        const result = await entry.provisioningService.createServer(request);
        if (!result.ok) {
          this.postMessage({
            v: WEBVIEW_PROTOCOL_VERSION,
            command: 'error',
            message: result.error.message,
          });
          return;
        }
      }

      this.dispose();
    } catch (e) {
      this.logger.error(`ServerFormPanel submit error: ${String(e)}`);
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'error',
        message: 'Unexpected error while saving.',
      });
    }
  }

  private handleValidate(data: Record<string, unknown>): void {
    const errors = validateServerForm(data);
    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'validationErrors',
      errors,
    });
  }

  private handleFieldValidation(field: string, value: unknown): void {
    let error: string | undefined;

    switch (field) {
      case 'name':
        if (typeof value !== 'string' || value.trim().length === 0) {
          error = 'Server name is required.';
        }
        break;
      case 'ports.http':
      case 'ports.debug':
        if (typeof value !== 'number' || value < 1 || value > 65535) {
          error = 'Port must be between 1 and 65535.';
        }
        break;
      case 'runtime.homePath':
      case 'javaHome':
        if (typeof value !== 'string' || value.trim().length === 0) {
          error = `${field === 'javaHome' ? 'JAVA_HOME' : 'Server Home'} is required.`;
        }
        break;
    }

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'fieldValidationResult',
      field,
      error,
    });
  }

  private async handleBrowse(
    field: string,
    kind: 'file' | 'directory',
    filters?: Record<string, string[]>,
  ): Promise<void> {
    const options: vscode.OpenDialogOptions = {
      canSelectFiles: kind === 'file',
      canSelectFolders: kind === 'directory',
      canSelectMany: false,
    };
    if (filters) {
      options.filters = filters;
    }

    const result = await vscode.window.showOpenDialog(options);
    if (result?.[0]) {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'browsed',
        field,
        path: result[0].fsPath,
      });
    }
  }

  private async refreshHookTaskOptions(): Promise<void> {
    const nextTaskOptions = await fetchHookTaskOptions(this.logger);
    if (areHookTaskOptionsEqual(this.hookTaskOptions, nextTaskOptions)) {
      return;
    }

    this.hookTaskOptions = nextTaskOptions;
    this.pushHookTaskOptions();
  }

  private pushHookTaskOptions(): void {
    if (!this.panel) {
      return;
    }

    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'hookOptions',
      fields: ['hooks'],
      taskOptions: this.hookTaskOptions,
    });
  }
}

// ── Form Data Helpers ───────────────────────────────────────────────────────

import type { ServerConfig } from '@core/types';

export function templateToServerFormData(template: ServerTemplate): Record<string, unknown> {
  const defaults = template.serverDefaults;
  
  // Convert nested structure to flat paths for formData
  const flatData: Record<string, unknown> = {};
  
  if (defaults.runtime?.homePath) flatData['runtime.homePath'] = defaults.runtime.homePath;
  if (defaults.javaHome) flatData['javaHome'] = defaults.javaHome;
  if (defaults.host) flatData['host'] = defaults.host;
  
  if (defaults.ports?.http !== undefined) flatData['ports.http'] = defaults.ports.http;
  if (defaults.ports?.debug !== undefined) flatData['ports.debug'] = defaults.ports.debug;
  
  if (defaults.run?.vmArgs) flatData['run.vmArgs'] = defaults.run.vmArgs;
  if (defaults.debug?.bind) flatData['debug.bind'] = defaults.debug.bind;
  
  if (defaults.hooks) flatData['hooks'] = defaults.hooks;
  
  if (defaults.pluginConfig) {
    const pluginConfig = defaults.pluginConfig as Record<string, any>;
    if (pluginConfig.ssl) {
      flatData['pluginConfig.ssl.enabled'] = pluginConfig.ssl.enabled;
      if (pluginConfig.ssl.port !== undefined) flatData['pluginConfig.ssl.port'] = pluginConfig.ssl.port;
      if (pluginConfig.ssl.keystorePath) flatData['pluginConfig.ssl.keystorePath'] = pluginConfig.ssl.keystorePath;
      if (pluginConfig.ssl.keystorePassword) flatData['pluginConfig.ssl.keystorePassword'] = pluginConfig.ssl.keystorePassword;
      if (pluginConfig.ssl.keystoreType) flatData['pluginConfig.ssl.keystoreType'] = pluginConfig.ssl.keystoreType;
      if (pluginConfig.ssl.keyAlias) flatData['pluginConfig.ssl.keyAlias'] = pluginConfig.ssl.keyAlias;
      
      if (pluginConfig.ssl.clientAuth !== undefined) flatData['pluginConfig.ssl.clientAuth'] = pluginConfig.ssl.clientAuth;
      if (pluginConfig.ssl.truststorePath) flatData['pluginConfig.ssl.truststorePath'] = pluginConfig.ssl.truststorePath;
      if (pluginConfig.ssl.truststorePassword) flatData['pluginConfig.ssl.truststorePassword'] = pluginConfig.ssl.truststorePassword;
      if (pluginConfig.ssl.truststoreType) flatData['pluginConfig.ssl.truststoreType'] = pluginConfig.ssl.truststoreType;
    }
  }
  
  return flatData;
}

export function serverConfigToFormData(config: ServerConfig): Record<string, unknown> {
  return {
    id: config.id,
    name: config.name,
    type: config.type,
    'runtime.homePath': config.runtime.homePath,
    'runtime.version': config.runtime.version,
    javaHome: config.javaHome,
    host: config.host,
    'ports.http': config.ports.http,
    'ports.debug': config.ports.debug,
    'run.vmArgs': config.run.vmArgs,
    'debug.bind': config.debug.bind,
    hooks: config.hooks,
    ...extractPluginConfig(config.pluginConfig),
  };
}

function extractPluginConfig(pluginConfig: any): Record<string, unknown> {
  if (!pluginConfig) return {};
  const result: Record<string, unknown> = {};
  if (pluginConfig.ssl) {
    result['pluginConfig.ssl.enabled'] = pluginConfig.ssl.enabled;
    result['pluginConfig.ssl.port'] = pluginConfig.ssl.port;
    result['pluginConfig.ssl.keystorePath'] = pluginConfig.ssl.keystorePath;
    result['pluginConfig.ssl.keystorePassword'] = pluginConfig.ssl.keystorePassword;
    result['pluginConfig.ssl.keystoreType'] = pluginConfig.ssl.keystoreType;
    result['pluginConfig.ssl.keyAlias'] = pluginConfig.ssl.keyAlias;
    result['pluginConfig.ssl.clientAuth'] = pluginConfig.ssl.clientAuth;
    result['pluginConfig.ssl.truststorePath'] = pluginConfig.ssl.truststorePath;
    result['pluginConfig.ssl.truststorePassword'] = pluginConfig.ssl.truststorePassword;
    result['pluginConfig.ssl.truststoreType'] = pluginConfig.ssl.truststoreType;
  }
  return result;
}

export function formDataToServerConfig(
  data: Record<string, unknown>,
  existing: ServerConfig,
): ServerConfig {
  return {
    ...existing,
    name: String(data['name'] ?? existing.name),
    host: String(data['host'] ?? existing.host),
    javaHome: String(data['javaHome'] ?? existing.javaHome),
    runtime: {
      ...existing.runtime,
      homePath: String(data['runtime.homePath'] ?? existing.runtime.homePath),
    },
    ports: {
      http: Number(data['ports.http'] ?? existing.ports.http),
      debug: Number(data['ports.debug'] ?? existing.ports.debug),
    },
    run: {
      ...existing.run,
      vmArgs: Array.isArray(data['run.vmArgs'])
        ? (data['run.vmArgs'] as string[])
        : existing.run.vmArgs,
    },
    debug: {
      ...existing.debug,
      bind: String(data['debug.bind'] ?? existing.debug.bind),
    },
    hooks: normalizeHookList(data['hooks'] ?? existing.hooks),
  };
}

function formDataToCreateServerRequest(data: Record<string, unknown>): CreateServerRequest {
  return {
    name: String(data['name'] ?? ''),
    type: 'tomcat',
    runtimeHomePath: String(data['runtime.homePath'] ?? ''),
    javaHome: String(data['javaHome'] ?? ''),
    host: String(data['host'] ?? '127.0.0.1'),
    httpPort: Number(data['ports.http'] ?? DEFAULT_HTTP_PORT),
    debugPort: Number(data['ports.debug'] ?? DEFAULT_DEBUG_PORT),
    debugBind: String(data['debug.bind'] ?? '127.0.0.1'),
    vmArgs: Array.isArray(data['run.vmArgs'])
      ? (data['run.vmArgs'] as string[])
      : [],
    hooks: normalizeHookList(data['hooks']),
  };
}

function validateServerForm(data: Record<string, unknown>): FieldError[] {
  const errors: FieldError[] = [];

  if (!data['name'] || String(data['name']).trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'Server name is required.',
      suggestedFix: 'Enter a display name for this server.',
    });
  }

  if (!data['runtime.homePath'] || String(data['runtime.homePath']).trim().length === 0) {
    errors.push({
      field: 'runtime.homePath',
      message: 'Server home path is required.',
      suggestedFix: 'Select the Tomcat installation directory.',
    });
  }

  if (!data['javaHome'] || String(data['javaHome']).trim().length === 0) {
    errors.push({
      field: 'javaHome',
      message: 'JAVA_HOME is required.',
      suggestedFix: 'Select the JDK installation directory.',
    });
  }

  const httpPort = Number(data['ports.http'] ?? DEFAULT_HTTP_PORT);
  if (!Number.isFinite(httpPort) || httpPort < 1 || httpPort > 65535) {
    errors.push({
      field: 'ports.http',
      message: 'HTTP port must be between 1 and 65535.',
      suggestedFix: `Use port ${DEFAULT_HTTP_PORT} (default) or another free port.`,
    });
  }

  const debugPort = Number(data['ports.debug'] ?? DEFAULT_DEBUG_PORT);
  if (!Number.isFinite(debugPort) || debugPort < 1 || debugPort > 65535) {
    errors.push({
      field: 'ports.debug',
      message: 'Debug port must be between 1 and 65535.',
      suggestedFix: `Use port ${DEFAULT_DEBUG_PORT} (default) or another free port.`,
    });
  }

  if (
    Number.isFinite(httpPort) && Number.isFinite(debugPort) &&
    httpPort === debugPort
  ) {
    errors.push({
      field: 'ports.debug',
      message: 'Debug port must differ from HTTP port.',
      suggestedFix: `Change debug port to ${httpPort + 1}.`,
    });
  }

  errors.push(...validateHookList(data['hooks']));

  return errors;
}

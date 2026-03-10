import * as vscode from 'vscode';
import type { ConfigService } from '@app/config/ConfigService';
import type { Logger } from '@core/types';
import type {
  FormSchema,
  WebviewToHost,
  FieldError,
} from '../protocol';
import { WEBVIEW_PROTOCOL_VERSION } from '../protocol';
import { normalizeHookList, validateHookList } from '../hookForm';
import { BaseFormPanel } from './BaseFormPanel';

// ── Dependency contract ─────────────────────────────────────────────────────

export interface ServerFormPanelDeps {
  extensionUri: vscode.Uri;
  configService: ConfigService;
  logger: Logger;
}

const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_DEBUG_PORT = 5005;

// ── Server Form Schema (§7.7) ──────────────────────────────────────────────

function serverFormSchema(mode: 'create' | 'edit'): FormSchema {
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
            helpText: 'Absolute path to the Tomcat installation directory.',
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
          {
            name: 'ports.debug',
            label: 'Debug Port',
            type: 'port',
            required: true,
            defaultValue: DEFAULT_DEBUG_PORT,
            validation: { min: 1, max: 65535 },
          },
          {
            name: 'instancePath',
            label: 'Instance Path',
            type: 'text',
            readOnly: true,
            helpText: 'Auto-generated per-server instance directory.',
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
            name: 'hooks',
            label: 'Hooks',
            type: 'hooks',
            defaultValue: [],
            helpText: 'Configure server hooks as terminal commands or VS Code tasks. New hooks start with a default Hook-N identifier used in logs and diagnostics.',
          },
        ],
      },
    ],
  };
}

// ── Panel ───────────────────────────────────────────────────────────────────

export class ServerFormPanel extends BaseFormPanel {
  static readonly viewType = 'jsm.serverForm';

  private readonly configService: ConfigService;
  private readonly logger: Logger;
  private editServerId: string | undefined;

  constructor(deps: ServerFormPanelDeps) {
    super(deps.extensionUri, ServerFormPanel.viewType, 'Server Configuration');
    this.configService = deps.configService;
    this.logger = deps.logger;
  }

  getFormSchema(mode: 'create' | 'edit'): FormSchema {
    return serverFormSchema(mode);
  }

  /** Open for create or edit. */
  open(mode: 'create' | 'edit', serverId?: string): void {
    this.editServerId = serverId;
    let data: Record<string, unknown> | undefined;

    if (mode === 'edit' && serverId) {
      const config = this.configService.getServer(serverId);
      if (config) data = serverConfigToFormData(config);
    }

    this.show(mode, data);
  }

  async handleMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.command) {
      case 'ready':
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
        if (this.editServerId) {
          const config = this.configService.getServer(this.editServerId);
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
            'ports.debug': DEFAULT_DEBUG_PORT,
            'debug.bind': '127.0.0.1',
          },
        });
        break;
    }
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
      if (this.editServerId) {
        const existing = this.configService.getServer(this.editServerId);
        if (!existing) {
          this.postMessage({
            v: WEBVIEW_PROTOCOL_VERSION,
            command: 'error',
            message: 'Server not found.',
          });
          return;
        }
        const updated = formDataToServerConfig(data, existing);
        const result = await this.configService.updateServer(updated);
        if (!result.ok) {
          this.postMessage({
            v: WEBVIEW_PROTOCOL_VERSION,
            command: 'error',
            message: result.error.message,
          });
          return;
        }
      } else {
        const config = formDataToNewServerConfig(data);
        const result = await this.configService.addServer(config);
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
}

// ── Form Data Helpers ───────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import type { ServerConfig } from '@core/types';

function serverConfigToFormData(config: ServerConfig): Record<string, unknown> {
  return {
    id: config.id,
    name: config.name,
    type: config.type,
    'runtime.homePath': config.runtime.homePath,
    'runtime.version': config.runtime.version,
    instancePath: config.instancePath,
    javaHome: config.javaHome,
    host: config.host,
    'ports.http': config.ports.http,
    'ports.debug': config.ports.debug,
    'run.vmArgs': config.run.vmArgs,
    'debug.bind': config.debug.bind,
    hooks: config.hooks,
  };
}

function formDataToServerConfig(
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

function formDataToNewServerConfig(data: Record<string, unknown>): ServerConfig {
  const id = uuid();
  return {
    id,
    name: String(data['name'] ?? ''),
    type: 'tomcat',
    runtime: {
      id: uuid(),
      homePath: String(data['runtime.homePath'] ?? ''),
    },
    instancePath: String(data['instancePath'] ?? ''),
    javaHome: String(data['javaHome'] ?? ''),
    host: String(data['host'] ?? '127.0.0.1'),
    ports: {
      http: Number(data['ports.http'] ?? DEFAULT_HTTP_PORT),
      debug: Number(data['ports.debug'] ?? DEFAULT_DEBUG_PORT),
    },
    run: {
      env: {},
      vmArgs: Array.isArray(data['run.vmArgs'])
        ? (data['run.vmArgs'] as string[])
        : [],
    },
    debug: {
      enabled: true,
      bind: String(data['debug.bind'] ?? '127.0.0.1'),
      attachDelayMs: 1000,
    },
    deployments: [],
    autosync: {
      enabled: true,
      debounceMs: 400,
      maxBatchFiles: 200,
      maxBatchBytes: 20_000_000,
      stormBackoffMs: 2000,
      ignoreGlobs: ['**/.git/**', '**/node_modules/**'],
    },
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

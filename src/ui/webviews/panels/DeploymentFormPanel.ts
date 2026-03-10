import * as vscode from 'vscode';
import type { WorkspaceServerLocator, WorkspaceServiceRegistry } from '@app/config';
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

export interface DeploymentFormPanelDeps {
  extensionUri: vscode.Uri;
  workspaceRegistry?: WorkspaceServiceRegistry;
  configService?: {
    getServer(serverId: string): any;
    updateServer(config: any): Promise<any>;
    addDeployment(serverId: string, deployment: any): Promise<any>;
  };
  logger: Logger;
}

// ── Deployment Form Schema ──────────────────────────────────────────────────

function deploymentFormSchema(mode: 'create' | 'edit'): FormSchema {
  return {
    title: mode === 'create' ? 'Add Deployment' : 'Edit Deployment',
    sections: [
      {
        id: 'deployment',
        title: 'Deployment',
        fields: [
          {
            name: 'type',
            label: 'Deployment Type',
            type: 'select',
            required: true,
            defaultValue: 'exploded',
            options: [
              { value: 'war', label: 'WAR' },
              { value: 'exploded', label: 'Exploded Directory' },
            ],
          },
          {
            name: 'sourcePath',
            label: 'Source Path',
            type: 'path',
            required: true,
            browse: { kind: 'directory' },
            helpText: 'Path to the WAR file or exploded directory.',
          },
          {
            name: 'deployName',
            label: 'Deploy Name',
            type: 'text',
            required: true,
            placeholder: 'myapp',
            helpText: 'Context path in webapps/. Must be alphanumeric with dots, dashes, underscores.',
            validation: {
              pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]*$',
              patternMessage: 'Must start with a letter/digit and contain only letters, digits, dots, dashes, underscores.',
            },
          },
          {
            name: 'syncMode',
            label: 'Auto-Sync',
            type: 'select',
            required: true,
            defaultValue: 'auto',
            options: [
              { value: 'manual', label: 'Manual' },
              { value: 'auto', label: 'Auto' },
            ],
            visibleWhen: { field: 'type', equals: 'exploded' },
            helpText: 'Only available for exploded deployments. Auto applies safe file changes and falls back to redeploy when needed.',
          },
        ],
      },
      {
        id: 'advanced',
        title: 'Advanced',
        collapsible: true,
        fields: [
          {
            name: 'ignoreGlobs',
            label: 'Ignore Patterns',
            type: 'tags',
            helpText: 'File patterns to exclude from sync.',
          },
          {
            name: 'hooks',
            label: 'Hooks',
            type: 'hooks',
            defaultValue: [],
            helpText: 'Configure deployment hooks as terminal commands or VS Code tasks. New hooks start with a default Hook-N identifier used in logs and diagnostics.',
          },
        ],
      },
    ],
  };
}

// ── Panel ───────────────────────────────────────────────────────────────────

export class DeploymentFormPanel extends BaseFormPanel {
  static readonly viewType = 'jsm.deploymentForm';

  private readonly workspaceRegistry: WorkspaceServiceRegistry;
  private readonly logger: Logger;
  private targetServer: WorkspaceServerLocator | undefined;
  private editDeploymentId: string | undefined;

  constructor(deps: DeploymentFormPanelDeps) {
    super(deps.extensionUri, DeploymentFormPanel.viewType, 'Deployment Configuration');
    this.workspaceRegistry = deps.workspaceRegistry ?? {
      getServer: (locator: WorkspaceServerLocator) => deps.configService?.getServer(locator.serverId),
      updateServer: (_locator: WorkspaceServerLocator, config: any) => deps.configService?.updateServer(config),
      addDeployment: (locator: WorkspaceServerLocator, deployment: any) => deps.configService?.addDeployment(locator.serverId, deployment),
      getAllServers: () => [],
    } as unknown as WorkspaceServiceRegistry;
    this.logger = deps.logger;
  }

  getFormSchema(mode: 'create' | 'edit'): FormSchema {
    return deploymentFormSchema(mode);
  }

  openCreate(targetServer: WorkspaceServerLocator): void {
    this.targetServer = targetServer;
    this.editDeploymentId = undefined;
    this.show('create');
  }

  openEdit(targetServer: WorkspaceServerLocator, deploymentId: string): void {
    this.targetServer = targetServer;
    this.editDeploymentId = deploymentId;
    let data: Record<string, unknown> | undefined;

    const server = this.workspaceRegistry.getServer(targetServer);
    const dep = server?.deployments.find(d => d.id === deploymentId);
    if (dep) {
      data = {
        id: dep.id,
        type: dep.type,
        sourcePath: dep.sourcePath,
        deployName: dep.deployName,
        syncMode: dep.syncMode,
        ignoreGlobs: dep.ignoreGlobs,
        hooks: dep.hooks,
      };
    }

    this.show('edit', data);
  }

  open(mode: 'create' | 'edit', serverId: string, deploymentId?: string): void {
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

    if (mode === 'create') {
      this.openCreate(locator);
      return;
    }

    if (deploymentId) {
      this.openEdit(locator, deploymentId);
    }
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
        if (this.targetServer && this.editDeploymentId) {
          const server = this.workspaceRegistry.getServer(this.targetServer);
          const dep = server?.deployments.find(d => d.id === this.editDeploymentId);
          if (dep) {
            this.postMessage({
              v: WEBVIEW_PROTOCOL_VERSION,
              command: 'loaded',
              data: {
                id: dep.id,
                type: dep.type,
                sourcePath: dep.sourcePath,
                deployName: dep.deployName,
                syncMode: dep.syncMode,
                ignoreGlobs: dep.ignoreGlobs,
                hooks: dep.hooks,
              },
            });
          }
        }
        break;

      case 'requestDefaults':
        this.postMessage({
          v: WEBVIEW_PROTOCOL_VERSION,
          command: 'defaults',
          data: {
            type: 'exploded',
            syncMode: 'auto',
            ignoreGlobs: [],
          },
        });
        break;
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────

  private async handleSubmit(data: Record<string, unknown>): Promise<void> {
    const errors = validateDeploymentForm(data);
    if (errors.length > 0) {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'validationErrors',
        errors,
      });
      return;
    }

    if (!this.targetServer) {
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'error',
        message: 'No target server selected.',
      });
      return;
    }

    try {
      if (this.editDeploymentId) {
        // Edit: update the deployment by replacing in the server config
        const server = this.workspaceRegistry.getServer(this.targetServer);
        if (!server) {
          this.postMessage({
            v: WEBVIEW_PROTOCOL_VERSION,
            command: 'error',
            message: 'Server not found.',
          });
          return;
        }

        const updatedDep = formDataToDeploymentConfig(data, this.editDeploymentId);
        const updatedServer = {
          ...server,
          deployments: server.deployments.map(d =>
            d.id === this.editDeploymentId ? updatedDep : d,
          ),
        };

        const result = await this.workspaceRegistry.updateServer(this.targetServer, updatedServer);
        if (!result.ok) {
          this.postMessage({
            v: WEBVIEW_PROTOCOL_VERSION,
            command: 'error',
            message: result.error.message,
          });
          return;
        }
      } else {
        // Create: add new deployment
        const { v4: uuid } = await import('uuid');
        const dep = formDataToDeploymentConfig(data, uuid());
        const result = await this.workspaceRegistry.addDeployment(this.targetServer, dep);
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
      this.logger.error(`DeploymentFormPanel submit error: ${String(e)}`);
      this.postMessage({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'error',
        message: 'Unexpected error while saving.',
      });
    }
  }

  private handleValidate(data: Record<string, unknown>): void {
    const errors = validateDeploymentForm(data);
    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'validationErrors',
      errors,
    });
  }

  private handleFieldValidation(field: string, value: unknown): void {
    let error: string | undefined;

    switch (field) {
      case 'sourcePath':
        if (typeof value !== 'string' || value.trim().length === 0) {
          error = 'Source path is required.';
        }
        break;
      case 'deployName': {
        const name = String(value ?? '');
        if (name.length === 0) {
          error = 'Deploy name is required.';
        } else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
          error = 'Must start with a letter/digit and contain only letters, digits, dots, dashes, underscores.';
        }
        break;
      }
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
    if (filters) options.filters = filters;

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

import type { DeploymentConfig, DeploymentType, SyncMode } from '@core/types';
import { DEPLOY_NAME_PATTERN } from '../../../constants';

function formDataToDeploymentConfig(
  data: Record<string, unknown>,
  id: string,
): DeploymentConfig {
  const type = (data['type'] as DeploymentType) ?? 'exploded';
  return {
    id,
    type,
    sourcePath: String(data['sourcePath'] ?? ''),
    deployName: String(data['deployName'] ?? ''),
    syncMode: type === 'war' ? 'manual' : ((data['syncMode'] as SyncMode) ?? 'auto'),
    ignoreGlobs: Array.isArray(data['ignoreGlobs'])
      ? (data['ignoreGlobs'] as string[])
      : [],
    hooks: normalizeHookList(data['hooks']),
  };
}

function validateDeploymentForm(data: Record<string, unknown>): FieldError[] {
  const errors: FieldError[] = [];

  if (!data['sourcePath'] || String(data['sourcePath']).trim().length === 0) {
    errors.push({
      field: 'sourcePath',
      message: 'Source path is required.',
      suggestedFix: 'Select the WAR file or exploded directory.',
    });
  }

  const deployName = String(data['deployName'] ?? '');
  if (deployName.length === 0) {
    errors.push({
      field: 'deployName',
      message: 'Deploy name is required.',
      suggestedFix: 'Enter a context name (e.g. "myapp").',
    });
  } else if (!DEPLOY_NAME_PATTERN.test(deployName)) {
    errors.push({
      field: 'deployName',
      message: 'Invalid deploy name format.',
      suggestedFix: 'Must start with a letter/digit and contain only letters, digits, dots, dashes, underscores.',
    });
  }

  const validTypes = new Set(['war', 'exploded']);
  if (!validTypes.has(String(data['type'] ?? ''))) {
    errors.push({
      field: 'type',
      message: 'Deployment type is required.',
      suggestedFix: 'Select WAR or Exploded Directory.',
    });
  }

  errors.push(...validateHookList(data['hooks']));

  return errors;
}

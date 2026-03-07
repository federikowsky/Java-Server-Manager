/*
 * src/ui/webviews/DeploymentFormPanel.ts
 * ULTRA-SIMPLIFIED Deployment Form Panel - Pure SRP approach
 * ONLY handles UI - NO validation, NO business logic
 */

import { 
  WebviewPanel, 
  window, 
  ViewColumn, 
  Disposable 
} from 'vscode';
import { DeploymentConfig } from '../../core/types/domain';
import { Result, ok, err } from '../../core/utils/result';
import { Logger } from '../../core/utils/logger';

interface PendingDeploymentForm<T> {
  resolve(value: Result<T, 'CANCELED'>): void;
  panel: WebviewPanel;
  disposables: Disposable[];
}

/**
 * PURE Deployment Form Panel - Single Responsibility: Handle deployment form UI
 * NO validation, NO business logic, ONLY form display and data collection
 */
export class DeploymentFormPanel {
  private static pending: PendingDeploymentForm<DeploymentConfig> | null = null;
  private static readonly log = Logger.getInstance().createChild('DeploymentFormPanel');

  /**
   * Show deployment form - auto-populates if deployment exists
   */
  static async showForm(serverId: string, deploymentId?: string): Promise<Result<DeploymentConfig, 'CANCELED'>> {
    // Close any existing panel
    if (DeploymentFormPanel.pending) {
      DeploymentFormPanel.pending.panel.dispose();
      DeploymentFormPanel.cleanup();
    }

    return new Promise<Result<DeploymentConfig, 'CANCELED'>>((resolve) => {
      const panel = window.createWebviewPanel(
        'deploymentForm',
        'Deployment Configuration',
        ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: []
        }
      );

      const disposables: Disposable[] = [];

      // Store pending operation
      DeploymentFormPanel.pending = { resolve, panel, disposables };

      // Handle panel disposal
      disposables.push(
        panel.onDidDispose(() => {
          DeploymentFormPanel.cleanup();
          resolve(err('CANCELED'));
        })
      );

      // Handle messages from webview
      disposables.push(
        panel.webview.onDidReceiveMessage(async (message) => {
          await DeploymentFormPanel.handleMessage(message, panel);
        })
      );

      // Set initial HTML content
      panel.webview.html = DeploymentFormPanel.renderFormHtml(serverId, deploymentId);
    });
  }

  // ==================== MESSAGE HANDLING ====================

  private static async handleMessage(message: any, panel: WebviewPanel): Promise<void> {
    try {
      switch (message.command) {
        case 'loadDeploymentData':
          await DeploymentFormPanel.handleLoadDeploymentData(message.serverId, message.deploymentId, panel);
          break;

        case 'validateInput':
          await DeploymentFormPanel.handleValidateInput(message.data, panel);
          break;

        case 'submitForm':
          await DeploymentFormPanel.handleSubmitForm(message.data, panel);
          break;

        case 'browse':
          await DeploymentFormPanel.handleBrowse(panel);
          break;

        case 'cancel':
          panel.dispose();
          break;

        default:
          DeploymentFormPanel.log.warn(`Unknown command: ${message.command}`);
      }
    } catch (error) {
      DeploymentFormPanel.log.error('Error handling message:', error);
      panel.webview.postMessage({
        command: 'error',
        message: 'An unexpected error occurred'
      });
    }
  }

  private static async handleLoadDeploymentData(serverId: string, deploymentId: string | undefined, panel: WebviewPanel): Promise<void> {
    if (!deploymentId) {
      panel.webview.postMessage({
        command: 'deploymentDataLoaded',
        data: null
      });
      return;
    }

    try {
      // Import dynamically to avoid circular dependencies
      const { ConfigManager } = await import('../../core/config/ConfigManager');
      const configManager = ConfigManager.getInstance();
      
      // Get server config first
      const serverResult = await configManager.getServer(serverId);
      if (!serverResult.ok) {
        panel.webview.postMessage({
          command: 'deploymentDataLoaded',
          data: null,
          error: serverResult.error.message
        });
        return;
      }

      // Find deployment in server config
      const deployment = serverResult.value.deployments?.find(d => d.id === deploymentId);
      if (!deployment) {
        panel.webview.postMessage({
          command: 'deploymentDataLoaded',
          data: null,
          error: `Deployment ${deploymentId} not found`
        });
        return;
      }
      
      panel.webview.postMessage({
        command: 'deploymentDataLoaded',
        data: deployment,
        error: null
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'deploymentDataLoaded',
        data: null,
        error: `Failed to load deployment data: ${error}`
      });
    }
  }

  private static async handleValidateInput(data: DeploymentConfig, panel: WebviewPanel): Promise<void> {
    try {
      // Basic client-side validation
      const errors: Record<string, string> = {};
      
      if (!data.sourcePath?.trim()) {
        errors.sourcePath = 'Source path is required';
      }
      
      if (data.deployName && data.deployName.includes('/')) {
        errors.deployName = 'Deploy name cannot contain path separators';
      }

      const isValid = Object.keys(errors).length === 0;
      
      panel.webview.postMessage({
        command: 'validationResult',
        isValid,
        errors: isValid ? null : errors
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'validationResult',
        isValid: false,
        errors: { general: `Validation failed: ${error}` }
      });
    }
  }

  private static async handleSubmitForm(data: DeploymentConfig, panel: WebviewPanel): Promise<void> {
    if (DeploymentFormPanel.pending) {
      DeploymentFormPanel.pending.resolve(ok(data));
      DeploymentFormPanel.cleanup();
    }
  }

  private static async handleBrowse(panel: WebviewPanel): Promise<void> {
    try {
      const fileUris = await window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select WAR File or Exploded Directory',
        filters: {
          'WAR Files': ['war'],
          'All Files': ['*']
        }
      });

      if (fileUris && fileUris.length > 0) {
        panel.webview.postMessage({
          command: 'sourcePathSelected',
          path: fileUris[0].fsPath
        });
      }
    } catch (error) {
      DeploymentFormPanel.log.error('Error browsing source:', error);
    }
  }

  // ==================== HTML RENDERING ====================

  private static renderFormHtml(serverId: string, deploymentId?: string): string {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Deployment Configuration</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                margin: 0;
                padding: 20px;
            }
            
            .form-container {
                max-width: 600px;
                margin: 0 auto;
            }
            
            .form-group {
                margin-bottom: 16px;
            }
            
            label {
                display: block;
                margin-bottom: 4px;
                font-weight: bold;
            }
            
            input[type="text"], select, textarea {
                width: 100%;
                padding: 8px;
                border: 1px solid var(--vscode-input-border);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 2px;
                box-sizing: border-box;
            }
            
            textarea {
                min-height: 80px;
                resize: vertical;
            }
            
            .input-with-button {
                display: flex;
                gap: 8px;
            }
            
            .input-with-button input {
                flex: 1;
            }
            
            .browse-btn {
                padding: 8px 12px;
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
                border: none;
                border-radius: 2px;
                cursor: pointer;
                white-space: nowrap;
            }
            
            .browse-btn:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }
            
            .button-group {
                display: flex;
                gap: 10px;
                margin-top: 20px;
            }
            
            button {
                padding: 8px 16px;
                border: none;
                border-radius: 2px;
                cursor: pointer;
                font-size: var(--vscode-font-size);
            }
            
            .primary {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            
            .primary:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            
            .secondary {
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }
            
            .secondary:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }
            
            .error {
                color: var(--vscode-errorForeground);
                margin-top: 4px;
                font-size: 12px;
            }
            
            .loading {
                opacity: 0.6;
                pointer-events: none;
            }
            
            .help-text {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                margin-top: 2px;
            }
            
            .type-buttons {
                display: flex;
                gap: 8px;
                margin-top: 8px;
            }
            
            .type-btn {
                padding: 6px 12px;
                border: 1px solid var(--vscode-input-border);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 2px;
                cursor: pointer;
                font-size: 12px;
            }
            
            .type-btn.active {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border-color: var(--vscode-button-background);
            }
        </style>
    </head>
    <body>
        <div class="form-container">
            <h1>${deploymentId ? 'Edit Deployment' : 'Create Deployment'}</h1>
            
            <form id="deploymentForm">
                <div class="form-group">
                    <label for="sourcePath">Source Path *</label>
                    <div class="input-with-button">
                        <input type="text" id="sourcePath" name="sourcePath" required 
                               placeholder="/path/to/app.war or /path/to/exploded/dir">
                        <button type="button" class="browse-btn" onclick="browse()">Browse</button>
                    </div>
                    <div class="help-text">Path to WAR file or exploded directory</div>
                    <div class="error" id="sourcePathError"></div>
                </div>
                
                <div class="form-group">
                    <label for="deployName">Deploy Name</label>
                    <input type="text" id="deployName" name="deployName" 
                           placeholder="Auto-generated from source path">
                    <div class="help-text">Name for deployment in webapps folder (determines URL path). Leave empty to auto-generate from source path.</div>
                    <div class="error" id="deployNameError"></div>
                </div>
                

                
                <div class="form-group">
                    <label for="ignoreGlobs">Ignore Patterns</label>
                    <textarea id="ignoreGlobs" name="ignoreGlobs" 
                              placeholder="**/.git/**&#10;**/node_modules/**&#10;**/.DS_Store"></textarea>
                    <div class="help-text">File patterns to ignore during sync (one per line)</div>
                    <div class="error" id="ignoreGlobsError"></div>
                </div>
                
                <div class="button-group">
                    <button type="submit" class="primary">
                        ${deploymentId ? 'Update Deployment' : 'Create Deployment'}
                    </button>
                    <button type="button" class="secondary" onclick="cancel()">Cancel</button>
                </div>
            </form>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            let isLoading = false;
            
            // Load deployment data if editing
            document.addEventListener('DOMContentLoaded', () => {
                const deploymentId = ${deploymentId ? `'${deploymentId}'` : 'null'};
                const serverId = '${serverId}';
                
                if (deploymentId) {
                    vscode.postMessage({
                        command: 'loadDeploymentData',
                        serverId: serverId,
                        deploymentId: deploymentId
                    });
                }
                
                // Set default ignore patterns if creating new deployment
                if (!deploymentId) {
                    document.getElementById('ignoreGlobs').value = '**/.git/**\\n**/node_modules/**\\n**/.DS_Store';
                }
            });
            
            // Handle form submission
            document.getElementById('deploymentForm').addEventListener('submit', (e) => {
                e.preventDefault();
                
                if (isLoading) return;
                
                const formData = new FormData(e.target);
                const data = {
                    id: ${deploymentId ? `'${deploymentId}'` : 'null'} || \`deployment-\${Date.now()}\`,
                    sourcePath: formData.get('sourcePath'),
                    deployName: formData.get('deployName') || undefined,
                    ignoreGlobs: formData.get('ignoreGlobs')
                        ? formData.get('ignoreGlobs').split('\\n').map(s => s.trim()).filter(s => s)
                        : ['**/.git/**', '**/node_modules/**', '**/.DS_Store']
                };
                
                // Validate before submit
                vscode.postMessage({
                    command: 'validateInput',
                    data: data
                });
            });
            
            // Browse function
            function browse() {
                vscode.postMessage({ command: 'browse' });
            }
            
            function cancel() {
                vscode.postMessage({ command: 'cancel' });
            }
            
            // Handle messages from extension
            window.addEventListener('message', (event) => {
                const message = event.data;
                
                switch (message.command) {
                    case 'deploymentDataLoaded':
                        if (message.data) {
                            populateForm(message.data);
                        } else if (message.error) {
                            showError('general', message.error);
                        }
                        break;
                        
                    case 'validationResult':
                        if (message.isValid) {
                            submitForm();
                        } else {
                            showValidationErrors(message.errors);
                        }
                        break;
                        
                    case 'sourcePathSelected':
                        document.getElementById('sourcePath').value = message.path;
                        break;
                        
                    case 'error':
                        showError('general', message.message);
                        break;
                }
            });
            
            function populateForm(data) {
                document.getElementById('sourcePath').value = data.sourcePath || '';
                document.getElementById('deployName').value = data.deployName || '';
                document.getElementById('ignoreGlobs').value = 
                    (data.ignoreGlobs || []).join('\\n');
            }
            
            function submitForm() {
                if (isLoading) return;
                
                setLoading(true);
                
                const formData = new FormData(document.getElementById('deploymentForm'));
                const data = {
                    id: ${deploymentId ? `'${deploymentId}'` : 'null'} || \`deployment-\${Date.now()}\`,
                    sourcePath: formData.get('sourcePath'),
                    deployName: formData.get('deployName') || undefined,
                    ignoreGlobs: formData.get('ignoreGlobs')
                        ? formData.get('ignoreGlobs').split('\\n').map(s => s.trim()).filter(s => s)
                        : ['**/.git/**', '**/node_modules/**', '**/.DS_Store']
                };
                
                vscode.postMessage({
                    command: 'submitForm',
                    data: data
                });
            }
            
            function showValidationErrors(errors) {
                // Clear previous errors
                document.querySelectorAll('.error').forEach(el => el.textContent = '');
                
                // Show new errors
                for (const [field, message] of Object.entries(errors)) {
                    const errorEl = document.getElementById(field + 'Error');
                    if (errorEl) {
                        errorEl.textContent = message;
                    }
                }
                
                setLoading(false);
            }
            
            function showError(field, message) {
                const errorEl = document.getElementById(field + 'Error');
                if (errorEl) {
                    errorEl.textContent = message;
                }
                setLoading(false);
            }
            
            function setLoading(loading) {
                isLoading = loading;
                const form = document.getElementById('deploymentForm');
                if (loading) {
                    form.classList.add('loading');
                } else {
                    form.classList.remove('loading');
                }
            }
        </script>
    </body>
    </html>
    `;
  }

  // ==================== CLEANUP ====================

  private static cleanup(): void {
    if (DeploymentFormPanel.pending) {
      DeploymentFormPanel.pending.disposables.forEach(d => d.dispose());
      DeploymentFormPanel.pending = null;
    }
  }
}

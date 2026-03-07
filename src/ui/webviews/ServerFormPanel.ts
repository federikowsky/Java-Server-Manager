/*
 * src/ui/webviews/ServerFormPanel.ts
 * ULTRA-SIMPLIFIED Form Panel - Pure SRP approach
 * ONLY handles UI - NO validation, NO business logic
 */

import { 
  WebviewPanel, 
  window, 
  ViewColumn, 
  Disposable, 
  Uri 
} from 'vscode';
import { ServerConfig } from '../../core/types/domain';
import { Result, ok, err } from '../../core/utils/result';
import { Logger } from '../../core/utils/logger';

interface PendingForm<T> {
  resolve(value: Result<T, 'CANCELED'>): void;
  panel: WebviewPanel;
  disposables: Disposable[];
}

/**
 * PURE Form Panel - Single Responsibility: Handle server form UI
 * NO validation, NO business logic, ONLY form display and data collection
 */
export class ServerFormPanel {
  private static pending: PendingForm<ServerConfig> | null = null;
  private static readonly log = Logger.getInstance().createChild('ServerFormPanel');

  /**
   * Show server form - auto-populates if server exists
   */
  static async showForm(serverId?: string): Promise<Result<ServerConfig, 'CANCELED'>> {
    // Close any existing panel
    if (ServerFormPanel.pending) {
      ServerFormPanel.pending.panel.dispose();
      ServerFormPanel.cleanup();
    }

    return new Promise<Result<ServerConfig, 'CANCELED'>>((resolve) => {
      const panel = window.createWebviewPanel(
        'serverForm',
        'Server Configuration',
        ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: []
        }
      );

      const disposables: Disposable[] = [];

      // Store pending operation
      ServerFormPanel.pending = { resolve, panel, disposables };

      // Handle panel disposal
      disposables.push(
        panel.onDidDispose(() => {
          ServerFormPanel.cleanup();
          resolve(err('CANCELED'));
        })
      );

      // Handle messages from webview
      disposables.push(
        panel.webview.onDidReceiveMessage(async (message) => {
          await ServerFormPanel.handleMessage(message, panel);
        })
      );

      // Set initial HTML content
      panel.webview.html = ServerFormPanel.renderFormHtml(serverId);
    });
  }

  // ==================== MESSAGE HANDLING ====================

  private static async handleMessage(message: any, panel: WebviewPanel): Promise<void> {
    try {
      switch (message.command) {
        case 'loadServerData':
          await ServerFormPanel.handleLoadServerData(message.serverId, panel);
          break;

        case 'validateInput':
          await ServerFormPanel.handleValidateInput(message.data, panel);
          break;

        case 'submitForm':
          await ServerFormPanel.handleSubmitForm(message.data, panel);
          break;

        case 'cancel':
          panel.dispose();
          break;

        default:
          ServerFormPanel.log.warn(`Unknown command: ${message.command}`);
      }
    } catch (error) {
      ServerFormPanel.log.error('Error handling message:', error);
      panel.webview.postMessage({
        command: 'error',
        message: 'An unexpected error occurred'
      });
    }
  }

  private static async handleLoadServerData(serverId: string, panel: WebviewPanel): Promise<void> {
    if (!serverId) {
      panel.webview.postMessage({
        command: 'serverDataLoaded',
        data: null
      });
      return;
    }

    try {
      // Import dynamically to avoid circular dependencies
      const { ConfigManager } = await import('../../core/config/ConfigManager');
      const manager = ConfigManager.getInstance();
      
      const result = await manager.getServer(serverId);
      
      panel.webview.postMessage({
        command: 'serverDataLoaded',
        data: result.ok ? result.value : null,
        error: result.ok ? null : result.error.message
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'serverDataLoaded',
        data: null,
        error: `Failed to load server data: ${error}`
      });
    }
  }

  private static async handleValidateInput(data: ServerConfig, panel: WebviewPanel): Promise<void> {
    try {
      // Import dynamically to avoid circular dependencies
      const { ServerController } = await import('../../core/controllers/ServerController');
      const controller = ServerController.getInstance();
      
      const result = await controller.validateOnly(data);
      
      panel.webview.postMessage({
        command: 'validationResult',
        isValid: result.ok,
        error: result.ok ? null : result.error.message
      });
    } catch (error) {
      panel.webview.postMessage({
        command: 'validationResult',
        isValid: false,
        error: `Validation failed: ${error}`
      });
    }
  }

  private static async handleSubmitForm(data: ServerConfig, panel: WebviewPanel): Promise<void> {
    if (ServerFormPanel.pending) {
      ServerFormPanel.pending.resolve(ok(data));
      ServerFormPanel.cleanup();
    }
  }

  // ==================== HTML RENDERING ====================

  private static renderFormHtml(serverId?: string): string {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Server Configuration</title>
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
            
            input[type="text"], input[type="number"], select {
                width: 100%;
                padding: 8px;
                border: 1px solid var(--vscode-input-border);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 2px;
                box-sizing: border-box;
            }
            
            input[type="checkbox"] {
                margin-right: 8px;
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
            
            .secondary {
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
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
        </style>
    </head>
    <body>
        <div class="form-container">
            <h1>${serverId ? 'Edit Server' : 'Create Server'}</h1>
            
            <form id="serverForm">
                <div class="form-group">
                    <label for="name">Server Name *</label>
                    <input type="text" id="name" name="name" required 
                           minlength="1" maxlength="100"
                           placeholder="e.g., Local Tomcat">
                    <div class="error" id="nameError"></div>
                </div>
                
                <div class="form-group">
                    <label for="javaHome">Java Home *</label>
                    <input type="text" id="javaHome" name="javaHome" required 
                           minlength="1"
                           placeholder="/usr/lib/jvm/java-11-openjdk">
                    <div class="error" id="javaHomeError"></div>
                </div>
                
                <div class="form-group">
                    <label for="serverHome">Server Home *</label>
                    <input type="text" id="serverHome" name="serverHome" required 
                           minlength="1"
                           placeholder="/opt/tomcat">
                    <div class="error" id="serverHomeError"></div>
                </div>
                
                <div class="form-group">
                    <label for="host">Host</label>
                    <input type="text" id="host" name="host" placeholder="localhost">
                </div>
                
                <div class="form-group">
                    <label for="port">Port</label>
                    <input type="number" id="port" name="port" min="1" max="65535" placeholder="8080">
                </div>
                
                <div class="form-group">
                    <label for="vmArgs">VM Arguments</label>
                    <input type="text" id="vmArgs" name="vmArgs" placeholder="-Xmx1024m -Xms512m">
                </div>
                
                <div class="form-group">
                    <label for="logPath">Log Path</label>
                    <input type="text" id="logPath" name="logPath" placeholder="/opt/tomcat/logs/catalina.out">
                </div>
                
                <div class="form-group">
                    <label for="workingDir">Working Directory</label>
                    <input type="text" id="workingDir" name="workingDir" placeholder="/opt/tomcat">
                </div>
                
                <div class="form-group">
                    <label for="startupTimeout">Startup Timeout (ms)</label>
                    <input type="number" id="startupTimeout" name="startupTimeout" min="1000" placeholder="30000">
                </div>
                
                <div class="form-group">
                    <label for="stopTimeout">Stop Timeout (ms)</label>
                    <input type="number" id="stopTimeout" name="stopTimeout" min="1000" placeholder="5000">
                </div>
                
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="autoSync" name="autoSync">
                        Enable Auto Sync
                    </label>
                </div>
                
                <div class="button-group">
                    <button type="submit" class="primary" id="submitBtn">Save</button>
                    <button type="button" class="secondary" id="cancelBtn">Cancel</button>
                </div>
            </form>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            const serverId = '${serverId || ''}';
            
            // Load existing server data if editing
            if (serverId) {
                vscode.postMessage({
                    command: 'loadServerData',
                    serverId: serverId
                });
            }
            
            // Handle server data loaded
            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.command) {
                    case 'serverDataLoaded':
                        if (message.data) {
                            populateForm(message.data);
                        } else if (message.error) {
                            showError('Failed to load server data: ' + message.error);
                        }
                        break;
                        
                    case 'validationResult':
                        if (!message.isValid) {
                            showError(message.error);
                        } else {
                            clearErrors();
                        }
                        break;
                        
                    case 'error':
                        showError(message.message);
                        break;
                }
            });
            
            // Form submission
            document.getElementById('serverForm').addEventListener('submit', (e) => {
                e.preventDefault();
                
                const formData = getFormData();
                
                vscode.postMessage({
                    command: 'submitForm',
                    data: formData
                });
            });
            
            // Cancel button
            document.getElementById('cancelBtn').addEventListener('click', () => {
                vscode.postMessage({ command: 'cancel' });
            });
            
            // Real-time validation
            document.getElementById('serverForm').addEventListener('input', debounce(() => {
                const formData = getFormData();
                
                vscode.postMessage({
                    command: 'validateInput',
                    data: formData
                });
            }, 500));
            
            function getFormData() {
                const form = document.getElementById('serverForm');
                const formData = new FormData(form);
                
                const data = {
                    name: formData.get('name'),
                    javaHome: formData.get('javaHome'),
                    serverHome: formData.get('serverHome'),
                    host: formData.get('host') || undefined,
                    port: formData.get('port') ? parseInt(formData.get('port')) : undefined,
                    vmArgs: formData.get('vmArgs') || undefined,
                    logPath: formData.get('logPath') || undefined,
                    workingDir: formData.get('workingDir') || undefined,
                    startupTimeout: formData.get('startupTimeout') ? parseInt(formData.get('startupTimeout')) : undefined,
                    stopTimeout: formData.get('stopTimeout') ? parseInt(formData.get('stopTimeout')) : undefined,
                    autoSync: document.getElementById('autoSync').checked
                };
                
                // Remove undefined values
                Object.keys(data).forEach(key => {
                    if (data[key] === undefined || data[key] === '') {
                        delete data[key];
                    }
                });
                
                return data;
            }
            
            function populateForm(data) {
                Object.keys(data).forEach(key => {
                    const element = document.getElementById(key);
                    if (element) {
                        if (element.type === 'checkbox') {
                            element.checked = data[key];
                        } else {
                            element.value = data[key] || '';
                        }
                    }
                });
            }
            
            function showError(message) {
                // For now, show in a simple alert
                // In the future, can be enhanced with better error display
                alert('Error: ' + message);
            }
            
            function clearErrors() {
                // Clear any error displays
            }
            
            function debounce(func, wait) {
                let timeout;
                return function executedFunction(...args) {
                    const later = () => {
                        clearTimeout(timeout);
                        func(...args);
                    };
                    clearTimeout(timeout);
                    timeout = setTimeout(later, wait);
                };
            }
        </script>
    </body>
    </html>
    `;
  }

  // ==================== CLEANUP ====================

  private static cleanup(): void {
    if (ServerFormPanel.pending) {
      ServerFormPanel.pending.disposables.forEach(d => d.dispose());
      ServerFormPanel.pending = null;
    }
  }
}

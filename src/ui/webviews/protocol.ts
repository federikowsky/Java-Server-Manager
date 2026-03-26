/**
 * Webview message protocol (§3.13) + FormSchema (§3.14).
 *
 * Shared types imported by BOTH host panels AND webview client.
 * No vscode imports here — this file must be buildable for the browser target.
 */

// ── Protocol version ────────────────────────────────────────────────────────

export const WEBVIEW_PROTOCOL_VERSION = 1 as const;

// ── Form Schema (§3.14) ────────────────────────────────────────────────────

export interface FormFieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'path' | 'select' | 'checkbox' | 'textarea' | 'tags' | 'port' | 'hooks' | 'password';
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
  readOnly?: boolean;
  options?: { value: string; label: string }[];
  browse?: { kind: 'file' | 'directory'; filters?: Record<string, string[]> };
  actionButtons?: Array<{ id: string; icon: string; title: string }>;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    patternMessage?: string;
  };
  visibleWhen?: { field: string; equals: unknown };
  hookOptions?: {
    events?: { value: string; label: string }[];
    defaultEvent?: string;
    taskOptions?: { value: string; label: string }[];
  };
}

export interface FormSection {
  id: string;
  title?: string;
  collapsible?: boolean;
  fields: FormFieldDef[];
}

export interface FormSchema {
  title: string;
  sections: FormSection[];
}

export interface FieldError {
  field: string;
  message: string;
  suggestedFix?: string;
}

export interface DashboardNavigationTarget {
  type: 'welcome' | 'server' | 'template' | 'new-server' | 'new-template' | 'settings' | 'deployment';
  id?: string;
  serverId?: string;
  mode?: 'create' | 'edit';
  templateId?: string;
  /** Top-level shell tab; default inferred from `type` when omitted. */
  globalTab?: 'home' | 'templates' | 'settings';
}

export interface SpaSettings {
  defaultHttpPort: number;
  defaultDebugPort: number;
  defaultJavaHome: string;
  showStatusInSidebar: boolean;
}

export interface HookTaskOption {
  value: string;
  label: string;
}

export interface SpaServerRecord {
  serverKey: string;
  config: unknown;
  workspaceFolderUri: string;
  workspaceFolderName: string;
}

// ── Messages: Webview → Host ────────────────────────────────────────────────

export type WebviewToHost =
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'ready' }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'submit'; data: Record<string, unknown> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'validate'; data: Record<string, unknown> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'validateField'; field: string; value: unknown }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'browse'; field: string; kind: 'file' | 'directory'; filters?: Record<string, string[]> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'invokeFieldAction'; field: string; actionId: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'cancel' }
  // SPA Commands
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'executeCommand'; id: string; args?: unknown[]; requestId?: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'deleteServer'; serverId: string; workspaceFolderUri: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'saveTemplate'; template: unknown; scope: 'global' | 'workspace' }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'deleteTemplate'; templateId: string; scope: 'global' | 'workspace' }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'requestWorkspaceFolders' }
  /** Forward webview diagnostics to host logger (Output: JSM). */
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'traceLog'; message: string; data?: unknown };

// ── Messages: Host → Webview ────────────────────────────────────────────────

export type HostToWebview =
  | { 
      v: typeof WEBVIEW_PROTOCOL_VERSION; 
      command: 'init'; 
      formId: string; 
      mode: 'create' | 'edit'; 
      data?: Record<string, unknown>; 
      schema: FormSchema;
      targetId?: string;
      targetWorkspaceFolderUri?: string;
      targetScope?: 'global' | 'workspace';
    }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'validationErrors'; errors: FieldError[] }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'fieldValidationResult'; field: string; error?: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'browsed'; field: string; path: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'fieldActionResult'; field: string; value: unknown }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'hookOptions'; fields: string[]; taskOptions: { value: string; label: string }[] }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'error'; message: string; details?: string }
  // SPA Events
  | { 
      v: typeof WEBVIEW_PROTOCOL_VERSION; 
      command: 'syncState'; 
      servers: SpaServerRecord[];
      runtimeStates: Record<string, unknown>;
      deploymentStates: Record<string, Record<string, string>>;
      templates: Array<{ template: unknown; scope: 'global' | 'workspace' }>;
      capabilities: Record<string, unknown>;
      workspaceFolders: Array<{ uri: string; name: string }>;
      settings: SpaSettings;
      /** Workspace trust; plan §2 principle 6 / §7.2 environment hints. */
      workspaceTrusted: boolean;
    }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'serverStateChanged'; serverKey: string; state: unknown }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'deploymentStateChanged'; serverKey: string; deploymentId: string; state: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'configChanged' }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'workspaceFoldersResult'; folders: Array<{ uri: string; name: string }> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'navigate'; target: DashboardNavigationTarget }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'commandResult'; requestId: string; ok: boolean; message?: string; data?: Record<string, unknown> };

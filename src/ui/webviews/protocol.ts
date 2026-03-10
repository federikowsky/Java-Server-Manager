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
  type: 'text' | 'number' | 'path' | 'select' | 'checkbox' | 'textarea' | 'tags' | 'port' | 'hooks';
  required?: boolean;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
  readOnly?: boolean;
  options?: { value: string; label: string }[];
  browse?: { kind: 'file' | 'directory'; filters?: Record<string, string[]> };
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    patternMessage?: string;
  };
  visibleWhen?: { field: string; equals: unknown };
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

// ── Messages: Webview → Host ────────────────────────────────────────────────

export type WebviewToHost =
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'ready' }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'submit'; data: Record<string, unknown> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'validate'; data: Record<string, unknown> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'validateField'; field: string; value: unknown }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'browse'; field: string; kind: 'file' | 'directory'; filters?: Record<string, string[]> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'cancel' }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'loadData'; id?: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'requestDefaults'; pluginType: string };

// ── Messages: Host → Webview ────────────────────────────────────────────────

export type HostToWebview =
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'init'; formId: string; mode: 'create' | 'edit'; data?: Record<string, unknown>; schema: FormSchema }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'loaded'; data: Record<string, unknown> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'validationErrors'; errors: FieldError[] }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'fieldValidationResult'; field: string; error?: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'browsed'; field: string; path: string }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'defaults'; data: Record<string, unknown> }
  | { v: typeof WEBVIEW_PROTOCOL_VERSION; command: 'error'; message: string; details?: string };

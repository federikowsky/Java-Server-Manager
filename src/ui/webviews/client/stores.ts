/**
 * Svelte stores — single source of truth for the webview form state.
 */

import { writable } from 'svelte/store';
import type { FormSchema } from '../protocol';

/** The form schema sent by the host on init. */
export const schema = writable<FormSchema | null>(null);

/** 'create' | 'edit' — set on init. */
export const mode = writable<'create' | 'edit'>('create');

/** The formId (e.g. 'jsm.serverForm'). Set on init. */
export const formId = writable<string>('');

/**
 * Flat key-value form data. Keys match FormFieldDef.name.
 * Nested domain fields use dot-notation: 'ports.http', 'runtime.homePath'.
 */
export const formData = writable<Record<string, unknown>>({});

/**
 * Per-field validation errors. Keys match field names.
 * Absent key = no error.
 */
export const fieldErrors = writable<Record<string, string>>({});

/** Whether a submit operation is in flight. */
export const submitting = writable<boolean>(false);

/** Top-level global error message (from host 'error' message). */
export const globalError = writable<string>('');

/** Available templates for ServerFormPanel in create mode. */
export const templates = writable<Array<{ id: string; name: string; defaults: Record<string, unknown> }>>([]);

// ── SPA Mode Stores ─────────────────────────────────────────────────────────

export type EntityType = 'server' | 'template' | 'new-server' | 'new-template' | 'settings' | 'deployment';

export interface ActiveEntity {
  type: EntityType;
  id?: string;
  /** For deployment entity: the server ID this deployment belongs to */
  serverId?: string;
  /** For deployment entity: 'create' or 'edit' mode */
  mode?: 'create' | 'edit';
}

export const activeEntity = writable<ActiveEntity>({ type: 'settings' });

export interface SpaSettings {
  autoDiscovery: boolean;
  scanEnvVars: boolean;
  scanCommonPaths: boolean;
  defaultHttpPort: number;
  defaultDebugPort: number;
  defaultJavaHome: string;
}

export const spaState = writable<{
  servers: Array<{ config: any; workspaceFolderUri: string; workspaceFolderName: string }>;
  runtimeStates: Record<string, any>;
  templates: Array<{ template: any; scope: 'global' | 'workspace' }>;
  capabilities: Record<string, any>;
  workspaceFolders: Array<{ uri: string; name: string }>;
  currentFormSchema?: import('../protocol').FormSchema;
  settings?: SpaSettings;
}>({
  servers: [],
  runtimeStates: {},
  templates: [],
  capabilities: {},
  workspaceFolders: [],
});

/** Browse dialog result — updated when host sends 'browsed' message */
export const browseResult = writable<{ field: string; path: string } | null>(null);

/** Host error message — updated when host sends 'error' message */
export const hostError = writable<string>('');

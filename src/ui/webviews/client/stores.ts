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

export type EntityType = 'server' | 'template' | 'new-server' | 'new-template' | 'settings';

export const activeEntity = writable<{ type: EntityType; id?: string }>({ type: 'settings' });

export const spaState = writable<{
  servers: Array<{ config: any; workspaceFolderUri: string; workspaceFolderName: string }>;
  runtimeStates: Record<string, any>;
  templates: Array<{ template: any; scope: 'global' | 'workspace' }>;
  capabilities: Record<string, any>;
  workspaceFolders: Array<{ uri: string; name: string }>;
}>({
  servers: [],
  runtimeStates: {},
  templates: [],
  capabilities: {},
  workspaceFolders: [],
});

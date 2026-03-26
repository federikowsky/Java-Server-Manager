/**
 * Svelte stores — single source of truth for the webview form state.
 */

import { writable } from 'svelte/store';
import type { DashboardNavigationTarget, FormSchema, SpaServerRecord, SpaSettings } from '../protocol';

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

// ── SPA Mode Stores ─────────────────────────────────────────────────────────

export type EntityType = DashboardNavigationTarget['type'];
export type ActiveEntity = DashboardNavigationTarget;

export const activeEntity = writable<ActiveEntity>({ type: 'welcome' });

export const spaState = writable<{
  initialized: boolean;
  servers: SpaServerRecord[];
  runtimeStates: Record<string, any>;
  deploymentStates: Record<string, Record<string, string>>; // serverKey -> deploymentId -> state
  templates: Array<{ template: any; scope: 'global' | 'workspace' }>;
  capabilities: Record<string, any>;
  workspaceFolders: Array<{ uri: string; name: string }>;
  currentFormSchema?: import('../protocol').FormSchema;
  currentFormId?: string;
  currentFormTargetId?: string;
  currentFormTargetWorkspaceFolderUri?: string;
  currentFormTargetScope?: 'global' | 'workspace';
  settings?: SpaSettings;
  hookTaskOptions?: Array<{ value: string; label: string }>;
}>({
  initialized: false,
  servers: [],
  runtimeStates: {},
  deploymentStates: {},
  templates: [],
  capabilities: {},
  workspaceFolders: [],
  hookTaskOptions: [],
});

/** Browse dialog result — updated when host sends 'browsed' message */
export const browseResult = writable<{ field: string; path: string } | null>(null);

/** Host error message — updated when host sends 'error' message */
export const hostError = writable<string>('');

/** Last command result emitted by the host for async SPA flows. */
export const lastCommandResult = writable<{
  requestId: string;
  ok: boolean;
  message?: string;
  data?: Record<string, unknown>;
} | null>(null);

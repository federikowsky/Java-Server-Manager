/**
 * Svelte stores — single source of truth for the webview form state.
 */

import { writable } from 'svelte/store';
import type { DashboardNavigationTarget, FormSchema, SpaServerRecord, SpaSettings } from '../protocol';
import type { DeploymentBuildConfig, HookConfig, PluginConfig, ServerType } from '@core/types';

/** Mirrors `syncState` payload in protocol (host → webview). */
export type SpaTemplateRow = { template: unknown; scope: 'global' | 'workspace' | 'gallery' };

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

export type ActiveEntity = DashboardNavigationTarget;

export const activeEntity = writable<ActiveEntity>({ type: 'welcome' });

export const spaState = writable<{
  initialized: boolean;
  servers: SpaServerRecord[];
  runtimeStates: Record<string, unknown>;
  deploymentStates: Record<string, Record<string, string>>; // serverKey -> deploymentId -> state
  /** From host syncState; HTTP health probe results per deployment (when configured). */
  deploymentHealth: Record<string, Record<string, { ok: boolean; latencyMs?: number }>>;
  /** From host syncState; derived recent operation timeline per server. */
  operationHistory: Record<string, unknown[]>;
  /** From host syncState; derived autosync watcher status per server. */
  autosyncDiagnostics: Record<string, unknown>;
  templates: SpaTemplateRow[];
  capabilities: Record<string, unknown>;
  workspaceFolders: Array<{ uri: string; name: string }>;
  currentFormSchema?: import('../protocol').FormSchema;
  currentFormId?: string;
  currentFormTargetId?: string;
  currentFormTargetWorkspaceFolderUri?: string;
  currentFormTargetScope?: 'global' | 'workspace';
  settings?: SpaSettings;
  hookTaskOptions?: Array<{ value: string; label: string }>;
  /** Primary shell tab (tree = inventory; SPA = detail / templates / settings). */
  globalTab: 'home' | 'templates' | 'settings';
  /** When returning from Hooks Editor, reopen server tab (spec §29). */
  serverDetailResumeTab?: 'overview' | 'config' | 'deployments';
  /** From host syncState; false limits side-effecting actions (plan §7.2). */
  workspaceTrusted: boolean;
}>({
  initialized: false,
  servers: [],
  runtimeStates: {},
  deploymentStates: {},
  deploymentHealth: {},
  operationHistory: {},
  autosyncDiagnostics: {},
  templates: [],
  capabilities: {},
  workspaceFolders: [],
  hookTaskOptions: [],
  globalTab: 'home',
  workspaceTrusted: true,
});

/**
 * MRU server ids opened from tree/dashboard (in-memory only; plan §7.2 recently opened).
 */
export const homeRecentServerIds = writable<string[]>([]);

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

/** Full-screen Hooks Editor: draft hooks + commit back to caller + restore navigation (spec §29). */
export const hooksEditorSession = writable<{
  draft: unknown[];
  fieldName: string;
  commit: (hooks: unknown[]) => void;
  returnTarget: ActiveEntity;
  eventOptions?: Array<{ value: string; label: string }>;
} | null>(null);

export interface ServerWizardDraftSnapshot {
  templateId?: string;
  creationMode: 'scratch' | 'template';
  selectedTemplateId: string;
  selectedType: ServerType;
  serverName: string;
  runtimeHome: string;
  javaHome: string;
  httpPort: number;
  debugPort?: number;
  host: string;
  vmArgs: string[];
  vmArgDraft: string;
  debugBind: string;
  selectedWorkspace: string;
  hooks: HookConfig[];
  draftPluginConfig?: PluginConfig;
}

export const serverWizardDraft = writable<ServerWizardDraftSnapshot | null>(null);

export interface DeploymentWizardDraftSnapshot {
  key: string;
  formType: 'exploded' | 'war';
  sourcePath: string;
  deployName: string;
  syncMode: 'auto' | 'manual';
  hotReload: boolean;
  healthCheckPath: string;
  healthCheckTimeoutMs?: number;
  ignoreGlobs: string[];
  ignoreGlobDraft: string;
  build?: DeploymentBuildConfig;
  buildEnvDraft: string;
  hooks: HookConfig[];
  lastInferredName: string;
  deployNameUserEdited: boolean;
}

export const deploymentWizardDraft = writable<DeploymentWizardDraftSnapshot | null>(null);

/**
 * Drop host-form mirror in spaState + related stores so the next editor session
 * must re-request schema (host `currentFormId` and webview `isFormReady` stay aligned).
 */
export function clearSpaFormMirror(): void {
  spaState.update(s => ({
    ...s,
    currentFormSchema: undefined,
    currentFormId: undefined,
    currentFormTargetId: undefined,
    currentFormTargetWorkspaceFolderUri: undefined,
    currentFormTargetScope: undefined,
  }));
  formId.set('');
  schema.set(null);
  mode.set('create');
  fieldErrors.set({});
  formData.set({});
  browseResult.set(null);
  submitting.set(false);
}

/**
 * Host → webview message dispatch. Keeps App.svelte thin; behavior matches prior App switch.
 */

import type { HostToWebview } from '../protocol';
import {
  activeEntity,
  browseResult,
  clearSpaFormMirror,
  fieldErrors,
  formData,
  formId,
  globalError,
  homeRecentServerIds,
  hostError,
  lastCommandResult,
  mode,
  schema,
  spaState,
  submitting,
} from './stores';
import { applyHookTaskOptions, collectSchemaDefaults } from './formSchemaUtils';

export function handleHostToWebviewMessage(msg: HostToWebview): void {
  switch (msg.command) {
    case 'validationErrors': {
      const errs: Record<string, string> = {};
      for (const e of msg.errors) {
        errs[e.field] = e.suggestedFix ? `${e.message} ${e.suggestedFix}` : e.message;
      }
      fieldErrors.set(errs);
      submitting.set(false);
      break;
    }
    case 'fieldValidationResult':
      fieldErrors.update(e => {
        const copy = { ...e };
        if (msg.error) {
          copy[msg.field] = msg.error;
        } else {
          delete copy[msg.field];
        }
        return copy;
      });
      break;
    case 'browsed':
      formData.update(d => ({ ...d, [msg.field]: msg.path }));
      browseResult.set({ field: msg.field, path: msg.path });
      break;
    case 'fieldActionResult':
      formData.update(d => ({ ...d, [msg.field]: msg.value }));
      break;
    case 'syncState':
      spaState.update(state => ({
        ...state,
        initialized: true,
        servers: msg.servers,
        runtimeStates: msg.runtimeStates,
        deploymentStates: msg.deploymentStates,
        deploymentHealth: msg.deploymentHealth,
        operationHistory: msg.operationHistory,
        autosyncDiagnostics: msg.autosyncDiagnostics,
        templates: msg.templates,
        environmentProfiles: msg.environmentProfiles,
        capabilities: msg.capabilities,
        workspaceFolders: msg.workspaceFolders,
        settings: msg.settings,
        workspaceTrusted: msg.workspaceTrusted,
      }));
      submitting.set(false);
      break;
    case 'serverStateChanged':
      spaState.update(state => ({
        ...state,
        runtimeStates: { ...state.runtimeStates, [msg.serverKey]: msg.state },
      }));
      break;
    case 'deploymentStateChanged':
      spaState.update(state => ({
        ...state,
        deploymentStates: {
          ...state.deploymentStates,
          [msg.serverKey]: {
            ...(state.deploymentStates?.[msg.serverKey] || {}),
            [msg.deploymentId]: msg.state,
          },
        },
      }));
      break;
    case 'init':
      spaState.update(s => ({
        ...s,
        currentFormSchema: msg.schema,
        currentFormId: msg.formId,
        currentFormTargetId: msg.targetId,
        currentFormTargetWorkspaceFolderUri: msg.targetWorkspaceFolderUri,
        currentFormTargetScope: msg.targetScope,
      }));
      formId.set(msg.formId);
      schema.set(msg.schema);
      mode.set(msg.mode);
      fieldErrors.set({});
      globalError.set('');
      hostError.set('');
      submitting.set(false);
      formData.set({
        ...collectSchemaDefaults(msg.schema),
        ...(msg.data ?? {}),
      });
      break;
    case 'hookOptions': {
      schema.update(current => (current ? applyHookTaskOptions(current, msg.fields, msg.taskOptions) : current));
      spaState.update(state => {
        const base = state.currentFormSchema;
        const nextForm = base ? applyHookTaskOptions(base, msg.fields, msg.taskOptions) : undefined;
        return {
          ...state,
          hookTaskOptions: msg.taskOptions,
          ...(nextForm ? { currentFormSchema: nextForm } : {}),
        };
      });
      break;
    }
    case 'workspaceFoldersResult':
      spaState.update(state => ({ ...state, workspaceFolders: msg.folders }));
      break;
    case 'navigate': {
      clearSpaFormMirror();
      activeEntity.set(msg.target);
      spaState.update(s => ({
        ...s,
        globalTab: msg.target.globalTab ?? s.globalTab,
      }));
      const t = msg.target;
      const recentId =
        t.type === 'server'
          ? t.serverKey ?? t.id
          : t.type === 'deployment'
            ? t.serverKey
            : undefined;
      if (recentId) {
        homeRecentServerIds.update(list => {
          const next = [recentId, ...list.filter(id => id !== recentId)];
          return next.slice(0, 8);
        });
      }
      break;
    }
    case 'commandResult':
      lastCommandResult.set({
        requestId: msg.requestId,
        ok: msg.ok,
        message: msg.message,
        data: msg.data,
      });
      break;
    case 'error':
      globalError.set(msg.message);
      hostError.set(msg.message);
      submitting.set(false);
      break;
    case 'submitFinished':
      submitting.set(false);
      break;
    default:
      break;
  }
}

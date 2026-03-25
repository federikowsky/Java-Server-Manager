<script lang="ts">
  import { onMount } from 'svelte';
  import { activeEntity, schema, mode, formId, formData, fieldErrors, submitting, globalError, spaState, browseResult, hostError, lastCommandResult } from './stores';
  import { sendReady, onHostMessage } from './bridge';
  import type { HostToWebview, FormSchema } from '../protocol';
  import FormHeader from './components/FormHeader.svelte';
  import FormBody from './components/FormBody.svelte';
  import FormActions from './components/FormActions.svelte';
  import GlobalError from './components/GlobalError.svelte';
  import Layout from './components/spa/Layout.svelte';

  let currentSchema = $state<import('../protocol').FormSchema | null>(null);
  let currentMode = $state<'create' | 'edit'>('create');
  let currentFormId = $state('');
  let currentGlobalError = $state('');
  let currentSubmitting = $state(false);

  schema.subscribe(v => { currentSchema = v; });
  mode.subscribe(v => { currentMode = v; });
  formId.subscribe(v => { currentFormId = v; });
  globalError.subscribe(v => { currentGlobalError = v; });
  submitting.subscribe(v => { currentSubmitting = v; });

  function collectSchemaDefaults(formSchema: FormSchema): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const section of formSchema.sections) {
      for (const field of section.fields) {
        if (field.defaultValue !== undefined) {
          defaults[field.name] = field.defaultValue;
        }
      }
    }
    return defaults;
  }

  function applyHookTaskOptions(formSchema: FormSchema, fieldNames: string[], taskOptions: { value: string; label: string }[]): FormSchema {
    const fieldNameSet = new Set(fieldNames);

    return {
      ...formSchema,
      sections: formSchema.sections.map(section => ({
        ...section,
        fields: section.fields.map(field => {
          if (field.type !== 'hooks' || !fieldNameSet.has(field.name)) {
            return field;
          }

          return {
            ...field,
            hookOptions: {
              ...(field.hookOptions ?? {}),
              taskOptions,
            },
          };
        }),
      })),
    };
  }

  function handleHostMessage(msg: HostToWebview): void {
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
          templates: msg.templates,
          capabilities: msg.capabilities,
          workspaceFolders: msg.workspaceFolders,
          settings: msg.settings,
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
      case 'hookOptions':
        schema.update(current => current ? applyHookTaskOptions(current, msg.fields, msg.taskOptions) : current);
        spaState.update(state => ({ ...state, hookTaskOptions: msg.taskOptions }));
        break;
      case 'workspaceFoldersResult':
        spaState.update(state => ({ ...state, workspaceFolders: msg.folders }));
        break;
      case 'navigate':
        activeEntity.set(msg.target);
        break;
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
    }
  }

  onMount(() => {
    performance.mark('jsm:mount');
    onHostMessage(handleHostMessage);
    sendReady();

    // Add spa-mode class to body for CSS overrides
    if ((window as any).__JSM_SPA_MODE__) {
      document.body.classList.add('spa-mode');
    }
  });
</script>

{#if (window as any).__JSM_SPA_MODE__}
  <Layout />
{:else}
  {#if currentSchema}
    <GlobalError message={currentGlobalError} />
    <FormHeader title={currentSchema.title} formId={currentFormId} />
    <FormBody sections={currentSchema.sections} />
    <FormActions mode={currentMode} submitting={currentSubmitting} formId={currentFormId} />
  {/if}
{/if}

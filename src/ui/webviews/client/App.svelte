<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { schema, mode, formId, formData, fieldErrors, submitting, globalError, templates, spaState, browseResult, hostError } from './stores';
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
      case 'loaded':
        formData.update(d => ({ ...d, ...msg.data }));
        break;
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
      case 'defaults':
        formData.update(d => ({ ...d, ...msg.data }));
        break;
      case 'syncState':
        spaState.set({
          servers: msg.servers,
          runtimeStates: msg.runtimeStates,
          templates: msg.templates,
          capabilities: msg.capabilities,
          workspaceFolders: msg.workspaceFolders,
          settings: (msg as any).settings,
        });
        break;
      case 'serverStateChanged':
        spaState.update(state => ({
          ...state,
          runtimeStates: { ...state.runtimeStates, [msg.serverId]: msg.state },
        }));
        break;
      case 'init':
        // Reuse init message for form schema
        spaState.update(s => ({ ...s, currentFormSchema: msg.schema }));
        formId.set(msg.formId);
        schema.set(msg.schema);
        mode.set(msg.mode);
        fieldErrors.set({});
        globalError.set('');
        submitting.set(false);
        formData.set({
          ...collectSchemaDefaults(msg.schema),
          ...(msg.data ?? {}),
        });
        if (msg.templates) {
          templates.set(msg.templates);
        }
        break;
      case 'hookOptions':
        schema.update(current => current ? applyHookTaskOptions(current, msg.fields, msg.taskOptions) : current);
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

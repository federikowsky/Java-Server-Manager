<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { schema, mode, formId, formData, fieldErrors, submitting, globalError } from './stores';
  import { sendReady, onHostMessage } from './bridge';
  import type { HostToWebview, FormSchema } from '../protocol';
  import FormHeader from './components/FormHeader.svelte';
  import FormBody from './components/FormBody.svelte';
  import FormActions from './components/FormActions.svelte';
  import GlobalError from './components/GlobalError.svelte';

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

  function handleHostMessage(msg: HostToWebview): void {
    switch (msg.command) {
      case 'init': {
        performance.mark('jsm:init-received');
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
        void tick().then(() => {
          requestAnimationFrame(() => {
            performance.mark('jsm:fcp');
            performance.measure('jsm:init-to-fcp', 'jsm:init-received', 'jsm:fcp');
          });
        });
        break;
      }
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
        break;
      case 'defaults':
        formData.update(d => ({ ...d, ...msg.data }));
        break;
      case 'error':
        globalError.set(msg.message);
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

{#if currentSchema}
  <GlobalError message={currentGlobalError} />
  <FormHeader title={currentSchema.title} formId={currentFormId} />
  <FormBody sections={currentSchema.sections} />
  <FormActions mode={currentMode} submitting={currentSubmitting} formId={currentFormId} />
{/if}

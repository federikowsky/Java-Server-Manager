<script lang="ts">
  import type { FormFieldDef } from '../../protocol';
  import { formData, fieldErrors } from '../stores';
  import { sendValidateField, sendBrowse } from '../bridge';
  import TextInput from './inputs/TextInput.svelte';
  import NumberInput from './inputs/NumberInput.svelte';
  import PortInput from './inputs/PortInput.svelte';
  import PathPicker from './inputs/PathPicker.svelte';
  import SelectInput from './inputs/SelectInput.svelte';
  import CheckboxInput from './inputs/CheckboxInput.svelte';
  import TextareaInput from './inputs/TextareaInput.svelte';
  import TagList from './inputs/TagList.svelte';

  const { def }: { def: FormFieldDef } = $props();

  let value = $state<unknown>(undefined);
  let error = $state('');
  let currentFormData = $state<Record<string, unknown>>({});

  formData.subscribe(d => {
    currentFormData = d;
    value = d[def.name] ?? def.defaultValue;
  });
  fieldErrors.subscribe(e => {
    error = e[def.name] ?? '';
  });

  // Conditional visibility
  let visible = $derived(
    def.visibleWhen
      ? currentFormData[def.visibleWhen.field] === def.visibleWhen.equals
      : true
  );

  // Debounce timers per field
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function handleChange(newValue: unknown): void {
    formData.update(d => ({ ...d, [def.name]: newValue }));
    // Debounced validateField
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      sendValidateField(def.name, newValue);
    }, 150);
  }

  function handleBrowse(kind: 'file' | 'directory', filters?: Record<string, string[]>): void {
    sendBrowse(def.name, kind, filters);
  }

  const hasError = $derived(error.length > 0);
  const fieldId = `field-${def.name}`;
  const helpId = `${def.name}-help`;
  const errorId = `${def.name}-error`;
</script>

{#if visible}
  <div class="form-field">
    <label class="field-label" for={fieldId}>
      {def.label}
      {#if def.required}<span class="required-mark"> *</span>{/if}
    </label>

    {#if def.type === 'path'}
      <PathPicker {def} value={value as string | undefined} onChange={handleChange} onBrowse={handleBrowse} id={fieldId} />
    {:else if def.type === 'port'}
      <PortInput {def} value={value as number | undefined} onChange={handleChange} id={fieldId} />
    {:else if def.type === 'tags'}
      <TagList {def} value={value as string[] | undefined} onChange={handleChange} id={fieldId} />
    {:else if def.type === 'select'}
      <SelectInput {def} value={value as string | undefined} onChange={handleChange} id={fieldId} />
    {:else if def.type === 'checkbox'}
      <CheckboxInput {def} value={value as boolean | undefined} onChange={handleChange} id={fieldId} />
    {:else if def.type === 'textarea'}
      <TextareaInput {def} value={value as string | undefined} onChange={handleChange} id={fieldId} />
    {:else if def.type === 'number'}
      <NumberInput {def} value={value as number | undefined} onChange={handleChange} id={fieldId} />
    {:else}
      <TextInput {def} value={value as string | undefined} onChange={handleChange} id={fieldId} />
    {/if}

    {#if def.helpText}
      <span class="field-help" id={helpId}>{def.helpText}</span>
    {/if}

    <span
      class="field-error"
      class:visible={hasError}
      id={errorId}
      role="alert"
      aria-live="polite"
    >
      {error}
    </span>
  </div>
{/if}

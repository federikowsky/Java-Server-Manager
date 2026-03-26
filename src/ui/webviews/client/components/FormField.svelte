<script lang="ts">
  import { get } from 'svelte/store';
  import type { FormFieldDef } from '../../protocol';
  import { formData, fieldErrors, formId, activeEntity, spaState, hooksEditorSession } from '../stores';
  import { sendValidateField, sendBrowse, postToHost } from '../bridge';
  import TextInput from './inputs/TextInput.svelte';
  import NumberInput from './inputs/NumberInput.svelte';
  import PortInput from './inputs/PortInput.svelte';
  import PathPicker from './inputs/PathPicker.svelte';
  import SelectInput from './inputs/SelectInput.svelte';
  import CheckboxInput from './inputs/CheckboxInput.svelte';
  import TextareaInput from './inputs/TextareaInput.svelte';
  import TagList from './inputs/TagList.svelte';
  import HookList from './HookList.svelte';
  import PasswordInput from './inputs/PasswordInput.svelte';

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

  function handleActionClick(actionId: string): void {
    postToHost({
      v: 1, // WEBVIEW_PROTOCOL_VERSION
      command: 'invokeFieldAction',
      field: def.name,
      actionId,
    });
  }

  const hasError = $derived(error.length > 0);
  let fieldId = $derived(`field-${def.name}`);
  let helpId = $derived(`${def.name}-help`);
  let errorId = $derived(`${def.name}-error`);

  let currentFormId = $state('');
  formId.subscribe(f => {
    currentFormId = f;
  });

  function openHooksEditor(): void {
    const hooks = Array.isArray(value) ? [...(value as unknown[])] : [];
    const ent = get(activeEntity);
    hooksEditorSession.set({
      draft: hooks,
      fieldName: def.name,
      commit: next => handleChange(next),
      returnTarget: ent,
    });
    if (ent.type === 'server' && ent.id) {
      spaState.update(s => ({ ...s, serverDetailResumeTab: 'config' }));
    }
    activeEntity.set({
      type: 'hooks-editor',
      serverId: ent.type === 'server' ? ent.id : undefined,
    });
  }
</script>

{#if visible}
  <div class="form-field">
    <label class="field-label" for={fieldId}>
      {def.label}
      {#if def.required}<span class="required-mark"> *</span>{/if}
    </label>

    {#if def.type === 'path'}
      <PathPicker {def} value={value as string | undefined} onChange={handleChange} onBrowse={handleBrowse} onAction={handleActionClick} id={fieldId} />
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
    {:else if def.type === 'hooks'}
      {#if currentFormId === 'jsm.serverForm'}
        <p class="hooks-inline-summary">
          {Array.isArray(value) && value.length > 0
            ? `${value.length} hook(s) configured`
            : 'No hooks configured yet'}
        </p>
        <button type="button" class="hooks-open-btn" onclick={openHooksEditor}>Open Hooks Editor</button>
      {:else}
        <HookList {def} value={value as import('@core/types').HookConfig[] | undefined} onChange={handleChange} id={fieldId} />
      {/if}
    {:else if def.type === 'password'}
      <PasswordInput {def} value={value as string | undefined} onChange={handleChange} id={fieldId} />
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

<style>
  .hooks-inline-summary {
    margin: 0 0 var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
  }
  .hooks-open-btn {
    display: inline-flex;
    align-items: center;
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-secondary-fg);
    background: var(--jsm-color-secondary);
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-sm);
    cursor: pointer;
  }
  .hooks-open-btn:hover {
    background: var(--jsm-color-secondary-hover);
  }
  .hooks-open-btn:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
</style>

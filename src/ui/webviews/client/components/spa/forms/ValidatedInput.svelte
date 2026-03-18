<script lang="ts">
  import Icon from '../../Icon.svelte';

  interface Props {
    label: string;
    value: string;
    type?: 'text' | 'number' | 'password';
    placeholder?: string;
    required?: boolean;
    error?: string;
    valid?: boolean;
    helpText?: string;
    disabled?: boolean;
    min?: number;
    max?: number;
    onInput?: (value: string) => void;
    onBlur?: () => void;
    id?: string;
  }

  let { 
    label, 
    value = $bindable(''),
    type = 'text',
    placeholder = '',
    required = false,
    error = '',
    valid = false,
    helpText = '',
    disabled = false,
    min,
    max,
    onInput,
    onBlur,
    id
  }: Props = $props();

  let inputId = $derived(id || `input-${label.toLowerCase().replace(/\s+/g, '-')}`);
  let touched = $state(false);
  let focused = $state(false);

  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    value = target.value;
    touched = true;
    onInput?.(value);
  }

  function handleBlur() {
    touched = true;
    focused = false;
    onBlur?.();
  }

  function handleFocus() {
    focused = true;
  }

  let showValidation = $derived(touched && !focused && (error || valid));
</script>

<div class="validated-input" class:has-error={error && touched} class:is-valid={valid && touched}>
  <label class="input-label" for={inputId}>
    {label}
    {#if required}
      <span class="required">*</span>
    {/if}
  </label>
  
  <div class="input-wrapper">
    <input
      id={inputId}
      {type}
      {placeholder}
      {disabled}
      {value}
      {min}
      {max}
      class="input-field"
      class:error={error && touched}
      class:valid={valid && touched}
      oninput={handleInput}
      onblur={handleBlur}
      onfocus={handleFocus}
    />
    
    {#if showValidation}
      <span class="input-icon" class:error-icon={error} class:valid-icon={valid}>
        {#if error}
          <Icon name="error" size={16} />
        {:else if valid}
          <Icon name="success" size={16} />
        {/if}
      </span>
    {/if}
  </div>
  
  {#if error && touched}
    <p class="input-error">{error}</p>
  {:else if helpText}
    <p class="input-help">{helpText}</p>
  {/if}
</div>

<style>
  .validated-input {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-xs);
  }

  .input-label {
    font-weight: var(--jsm-font-weight-semibold);
    font-size: var(--jsm-font-size-md);
    color: var(--jsm-color-fg);
  }

  .required {
    color: var(--jsm-color-error);
    margin-left: var(--jsm-space-2xs);
  }

  .input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .input-field {
    width: 100%;
    padding: var(--jsm-input-padding-y) var(--jsm-input-padding-x);
    padding-right: 36px;
    background: var(--jsm-input-bg);
    color: var(--jsm-input-fg);
    border: 1px solid var(--jsm-input-border);
    border-radius: var(--jsm-input-radius);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    outline: none;
    transition: border-color var(--jsm-transition-normal), box-shadow var(--jsm-transition-normal);
  }

  .input-field:focus {
    border-color: var(--jsm-color-border-focus);
    box-shadow: var(--jsm-shadow-focus);
  }

  .input-field.error {
    border-color: var(--jsm-color-error);
  }

  .input-field.error:focus {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--jsm-color-error) 30%, transparent);
  }

  .input-field.valid {
    border-color: var(--jsm-status-running);
  }

  .input-icon {
    position: absolute;
    right: var(--jsm-space-sm);
    display: flex;
    align-items: center;
    animation: jsm-fade-in var(--jsm-transition-fast) ease-out;
  }

  .error-icon {
    color: var(--jsm-color-error);
  }

  .valid-icon {
    color: var(--jsm-status-running);
  }

  .input-error {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-error);
    margin: 0;
    animation: jsm-slide-down var(--jsm-transition-fast) ease-out;
  }

  .input-help {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
    margin: 0;
  }
</style>

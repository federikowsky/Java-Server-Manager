<script lang="ts">
  import type { FormFieldDef } from '../../../protocol';

  const { def, value, onChange, id }: {
    def: FormFieldDef;
    value: string | undefined;
    onChange: (v: string) => void;
    id: string;
  } = $props();

  let showPassword = $state(false);

  function toggleVisibility(): void {
    showPassword = !showPassword;
  }
</script>

<div class="password-input-wrapper">
  <input
    type={showPassword ? 'text' : 'password'}
    class="field-input"
    {id}
    data-field={def.name}
    placeholder={def.placeholder ?? ''}
    readonly={def.readOnly ?? false}
    aria-required={def.required ?? false}
    value={value ?? ''}
    oninput={(e: Event) => onChange((e.target as HTMLInputElement).value)}
  />
  <button
    type="button"
    class="password-toggle"
    onclick={toggleVisibility}
    aria-label={showPassword ? 'Hide password' : 'Show password'}
    tabindex="-1"
  >
    {showPassword ? '🙈' : '👁'}
  </button>
</div>

<style>
  .password-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .password-input-wrapper .field-input {
    padding-right: 2.5em;
  }

  .password-toggle {
    position: absolute;
    right: 0.5em;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25em;
    font-size: 1em;
    opacity: 0.7;
  }

  .password-toggle:hover {
    opacity: 1;
  }
</style>

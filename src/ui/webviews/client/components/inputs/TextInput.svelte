<script lang="ts">
  import type { FormFieldDef } from '../../../protocol';

  const { def, value, onChange, id }: {
    def: FormFieldDef;
    value: string | undefined;
    onChange: (v: string) => void;
    id: string;
  } = $props();
</script>

<input
  type="text"
  class="field-input"
  {id}
  data-field={def.name}
  placeholder={def.placeholder ?? ''}
  readonly={def.readOnly ?? false}
  aria-required={def.required ?? false}
  value={value ?? ''}
  oninput={(e: Event) => onChange((e.target as HTMLInputElement).value)}
/>

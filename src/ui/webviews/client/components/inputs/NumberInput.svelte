<script lang="ts">
  import type { FormFieldDef } from '../../../protocol';

  const { def, value, onChange, id }: {
    def: FormFieldDef;
    value: number | undefined;
    onChange: (v: number) => void;
    id: string;
  } = $props();
</script>

<input
  type="number"
  class="field-input"
  {id}
  data-field={def.name}
  min={def.validation?.min}
  max={def.validation?.max}
  readonly={def.readOnly ?? false}
  aria-required={def.required ?? false}
  value={value ?? ''}
  oninput={(e: Event) => {
    const num = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(num)) onChange(num);
  }}
/>

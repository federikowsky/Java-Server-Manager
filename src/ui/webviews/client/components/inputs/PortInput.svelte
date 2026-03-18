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
  class="field-input port-input"
  {id}
  data-field={def.name}
  min={def.validation?.min ?? 1}
  max={def.validation?.max ?? 65535}
  readonly={def.readOnly ?? false}
  aria-required={def.required ?? false}
  value={value ?? def.defaultValue ?? ''}
  oninput={(e: Event) => {
    const num = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(num) && num === Math.floor(num)) onChange(num);
  }}
/>

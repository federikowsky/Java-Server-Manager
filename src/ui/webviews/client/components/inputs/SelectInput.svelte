<script lang="ts">
  import type { FormFieldDef } from '../../../protocol';

  const { def, value, onChange, id }: {
    def: FormFieldDef;
    value: string | undefined;
    onChange: (v: string) => void;
    id: string;
  } = $props();
</script>

<select
  class="field-input"
  {id}
  data-field={def.name}
  aria-required={def.required ?? false}
  onchange={(e: Event) => onChange((e.target as HTMLSelectElement).value)}
>
  {#each def.options ?? [] as opt (opt.value)}
    <option value={opt.value} selected={value === opt.value || (value === undefined && def.defaultValue === opt.value)}>
      {opt.label}
    </option>
  {/each}
</select>

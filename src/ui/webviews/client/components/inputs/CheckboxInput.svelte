<script lang="ts">
  import type { FormFieldDef } from '../../../protocol';

  const { def, value, onChange, id }: {
    def: FormFieldDef;
    value: boolean | undefined;
    onChange: (v: boolean) => void;
    id: string;
  } = $props();
</script>

<div class="field-checkbox-row">
  <input
    type="checkbox"
    class="field-checkbox"
    {id}
    data-field={def.name}
    checked={value ?? false}
    onchange={(e: Event) => onChange((e.target as HTMLInputElement).checked)}
  />
  {#if def.helpText}
    <span class="field-checkbox-label">{def.helpText}</span>
  {/if}
</div>

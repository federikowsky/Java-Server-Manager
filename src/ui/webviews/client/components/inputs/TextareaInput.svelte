<script lang="ts">
  import type { FormFieldDef } from '../../../protocol';

  const { def, value, onChange, id }: {
    def: FormFieldDef;
    value: string | undefined;
    onChange: (v: string) => void;
    id: string;
  } = $props();
</script>
<textarea
  class="field-input field-textarea"
  {id}
  data-field={def.name}
  rows="4"
  readonly={def.readOnly ?? false}
  placeholder={def.placeholder ?? ''}
  aria-required={def.required ?? false}
  oninput={(e: Event) => onChange((e.target as HTMLTextAreaElement).value)}
>{value ?? ''}</textarea>

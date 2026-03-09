<script lang="ts">
  import type { FormFieldDef } from '../../../protocol';

  const { def, value, onChange, onBrowse, id }: {
    def: FormFieldDef;
    value: string | undefined;
    onChange: (v: string) => void;
    onBrowse: (kind: 'file' | 'directory', filters?: Record<string, string[]>) => void;
    id: string;
  } = $props();

  function handleBrowseClick(): void {
    const kind = def.browse?.kind ?? 'directory';
    onBrowse(kind, def.browse?.filters);
  }
</script>

<div class="path-picker-row">
  <input
    type="text"
    class="field-input path-input"
    {id}
    data-field={def.name}
    readonly={def.readOnly ?? false}
    placeholder={def.placeholder ?? ''}
    aria-required={def.required ?? false}
    value={value ?? ''}
    oninput={(e: Event) => onChange((e.target as HTMLInputElement).value)}
  />
  <button type="button" class="browse-button" onclick={handleBrowseClick}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.5 1h5l1 2H14.5a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/>
    </svg>
    Browse…
  </button>
</div>

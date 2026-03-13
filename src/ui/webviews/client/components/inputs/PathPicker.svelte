<script lang="ts">
  import type { FormFieldDef } from '../../../protocol';

  const { def, value, onChange, onBrowse, onAction, id }: {
    def: FormFieldDef;
    value: string | undefined;
    onChange: (v: string) => void;
    onBrowse: (kind: 'file' | 'directory', filters?: Record<string, string[]>) => void;
    onAction?: (actionId: string) => void;
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
  {#if def.actionButtons && onAction}
    {#each def.actionButtons as action}
      <button type="button" class="action-button" title={action.title} onclick={() => onAction(action.id)}>
        {#if action.icon === 'search'}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M10.473 11.533A5.75 5.75 0 1 1 11.533 10.473L15 13.94l-1.06 1.06-3.467-3.467zM10.5 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0z" />
          </svg>
        {:else}
          {action.icon}
        {/if}
      </button>
    {/each}
  {/if}
</div>

<style>
  .action-button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    cursor: pointer;
    font-size: 13px;
    height: 26px;
    margin-left: 4px;
  }
  .action-button:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
</style>

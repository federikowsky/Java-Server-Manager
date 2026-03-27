<script lang="ts">
  import { onDestroy } from 'svelte';
  import { activeEntity, clearSpaFormMirror, spaState } from '../../stores';
  import type { ActiveEntity } from '../../stores';
  import RootPageHeader from '../ds/RootPageHeader.svelte';
  import PageState from '../ds/PageState.svelte';
  import TemplateReadonlyPage from './TemplateReadonlyPage.svelte';
  import TemplateEditorPage from './TemplateEditorPage.svelte';
  import HooksEditorPage from './HooksEditorPage.svelte';

  let state = $state($spaState);
  const unsubState = spaState.subscribe(s => {
    state = s;
  });

  let currentEntity = $state<ActiveEntity>($activeEntity);
  const unsubEntity = activeEntity.subscribe(e => {
    currentEntity = e;
  });

  onDestroy(() => {
    unsubState();
    unsubEntity();
  });

  let search = $state('');

  /** Max characters for Description column in the list (full text on hover when truncated). */
  const MAX_DESCRIPTION_LIST_CHARS = 100;

  function listDescriptionCell(description: unknown): { text: string; title: string | undefined } {
    const raw = description == null ? '' : String(description).trim();
    if (raw.length === 0) {
      return { text: '—', title: undefined };
    }
    if (raw.length <= MAX_DESCRIPTION_LIST_CHARS) {
      return { text: raw, title: undefined };
    }
    const cut = raw.slice(0, MAX_DESCRIPTION_LIST_CHARS).trimEnd();
    return { text: `${cut}…`, title: raw };
  }

  let filtered = $derived(
    state.templates.filter(({ template: t }) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      const name = String(t.name ?? '').toLowerCase();
      const desc = String((t as { description?: string }).description ?? '').toLowerCase();
      return name.includes(q) || desc.includes(q);
    }),
  );

  function goNewTemplate(): void {
    clearSpaFormMirror();
    activeEntity.set({ type: 'new-template' });
  }

  function openRow(id: string): void {
    clearSpaFormMirror();
    activeEntity.set({ type: 'template', id });
  }

  function onRowKeydown(e: KeyboardEvent, id: string): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      openRow(id);
    }
  }
</script>

{#if currentEntity.type === 'hooks-editor'}
  <HooksEditorPage />
{:else if currentEntity.type === 'template' && currentEntity.id}
  <TemplateReadonlyPage templateId={currentEntity.id} />
{:else if currentEntity.type === 'new-template'}
  <TemplateEditorPage />
{:else if currentEntity.type === 'edit-template' && currentEntity.id}
  <TemplateEditorPage templateId={currentEntity.id} />
{:else}
  <div class="templates-list jsm-page-padding jsm-stack-lg">
    <RootPageHeader
      title="Templates"
      subtitle="Reusable provisioning defaults for managed instances"
    >
      <svelte:fragment slot="actions">
        <button type="button" class="btn-primary" onclick={goNewTemplate}>New Template</button>
      </svelte:fragment>
    </RootPageHeader>

    <div class="search-row">
      <label class="search-label" for="tpl-search">Search</label>
      <input
        id="tpl-search"
        class="search-input"
        type="search"
        placeholder="tomcat…"
        bind:value={search}
        autocomplete="off"
      />
    </div>

    {#if filtered.length === 0}
      <PageState
        title="No templates found"
        description="Create a new template or adjust your search."
      >
        <svelte:fragment slot="actions">
          <button type="button" class="btn-primary" onclick={goNewTemplate}>New Template</button>
        </svelte:fragment>
      </PageState>
    {:else}
      <div class="table-wrap jsm-surface-section" role="region" aria-label="Templates">
        <table class="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Server Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {#each filtered as row (row.template.id)}
              {@const descCell = listDescriptionCell(row.template.description)}
              <tr
                class="row-click"
                tabindex="0"
                role="button"
                onclick={() => openRow(row.template.id)}
                onkeydown={(e) => onRowKeydown(e, row.template.id)}
              >
                <td class="cell-strong">{row.template.name}</td>
                <td>{row.scope}</td>
                <td>{row.template.pluginType}</td>
                <td class="cell-muted cell-desc" title={descCell.title}>{descCell.text}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="hint jsm-type-meta">Select a template to inspect or edit.</p>
    {/if}
  </div>
{/if}

<style>
  .templates-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .search-row {
    max-width: 28rem;
    display: flex;
    align-items: center;
    gap: var(--jsm-space-md);
  }
  .search-label {
    flex-shrink: 0;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
    font-weight: var(--jsm-font-weight-medium);
  }
  .search-input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    border: 1px solid var(--jsm-input-border);
    border-radius: var(--jsm-input-radius);
    background: var(--jsm-input-bg);
    color: var(--jsm-input-fg);
  }
  .table-wrap {
    overflow: auto;
    min-width: 0;
  }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--jsm-font-size-sm);
  }
  .data-table th {
    text-align: left;
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg-secondary);
    border-bottom: 1px solid var(--jsm-color-border-secondary);
    white-space: nowrap;
  }
  .data-table td {
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    border-bottom: 1px solid color-mix(in srgb, var(--jsm-color-border-secondary) 70%, transparent);
    vertical-align: top;
  }
  .row-click {
    cursor: pointer;
  }
  .row-click:hover {
    background: var(--jsm-color-bg-hover);
  }
  .row-click:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: -2px;
  }
  .cell-strong {
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }
  .cell-muted {
    color: var(--jsm-color-fg-secondary);
  }
  .cell-desc {
    max-width: 28rem;
    overflow: hidden;
    word-break: break-word;
  }
  .hint {
    margin: 0;
  }
  .btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--jsm-space-sm) var(--jsm-space-lg);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-primary-fg);
    background: var(--jsm-color-primary);
    border: none;
    border-radius: var(--jsm-btn-radius);
    cursor: pointer;
  }
  .btn-primary:hover {
    background: var(--jsm-color-primary-hover);
  }
  .btn-primary:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
</style>

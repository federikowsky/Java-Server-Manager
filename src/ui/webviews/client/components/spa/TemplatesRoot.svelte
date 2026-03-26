<script lang="ts">
  import { onDestroy } from 'svelte';
  import { activeEntity, spaState } from '../../stores';
  import type { ActiveEntity } from '../../stores';
  import RootPageHeader from '../ds/RootPageHeader.svelte';
  import PageState from '../ds/PageState.svelte';
  import TemplateReadonlyPage from './TemplateReadonlyPage.svelte';
  import TemplateEditorPage from './TemplateEditorPage.svelte';

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
    activeEntity.set({ type: 'new-template' });
  }

  function openRow(id: string): void {
    activeEntity.set({ type: 'template', id });
  }

  function onRowKeydown(e: KeyboardEvent, id: string): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      openRow(id);
    }
  }
</script>

{#if currentEntity.type === 'template' && currentEntity.id}
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
      <label class="sr-only" for="tpl-search">Search templates</label>
      <input
        id="tpl-search"
        class="search-input"
        type="search"
        placeholder="Filter by name or description…"
        bind:value={search}
        autocomplete="off"
      />
    </div>

    {#if filtered.length === 0}
      <PageState
        title={state.templates.length === 0 ? 'No templates yet' : 'No matches'}
        description={state.templates.length === 0
          ? 'Create a template to capture defaults for new servers.'
          : 'Try a different search term.'}
      >
        <svelte:fragment slot="actions">
          {#if state.templates.length === 0}
            <button type="button" class="btn-primary" onclick={goNewTemplate}>New Template</button>
          {/if}
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
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {#each filtered as row (row.template.id)}
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
                <td class="cell-muted">{row.template.description ?? '—'}</td>
                <td class="cell-muted">—</td>
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
  }
  .search-input {
    width: 100%;
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
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
</style>

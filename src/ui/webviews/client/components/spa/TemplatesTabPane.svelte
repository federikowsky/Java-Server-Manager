<script lang="ts">
  import { onDestroy } from 'svelte';
  import { spaState, activeEntity } from '../../stores';
  import Icon from '../Icon.svelte';
  import TemplateDetail from './TemplateDetail.svelte';

  let state = $state($spaState);
  const unsubscribeSpaState = spaState.subscribe(s => {
    state = s;
  });

  let currentEntity = $state($activeEntity);
  const unsubscribeActiveEntity = activeEntity.subscribe(e => {
    currentEntity = e;
  });

  onDestroy(() => {
    unsubscribeSpaState();
    unsubscribeActiveEntity();
  });

  function selectTemplate(id: string) {
    activeEntity.set({ type: 'template', id });
  }

  function newTemplate() {
    activeEntity.set({ type: 'new-template' });
  }
</script>

<div class="templates-tab">
  <section class="list-region" aria-label="Template list">
    <div class="section-header">
      <span class="section-label">
        <Icon name="file-code" size={14} />
        <span>Templates</span>
      </span>
      <button
        type="button"
        class="icon-button"
        aria-label="Create template"
        title="Create template"
        onclick={newTemplate}
      >
        <Icon name="add" size={14} />
      </button>
    </div>
    <div class="section-list">
      {#each state.templates as tpl}
        <button
          type="button"
          class="list-item"
          class:active={currentEntity.type === 'template' && currentEntity.id === tpl.template.id}
          onclick={() => selectTemplate(tpl.template.id)}
        >
          <span class="item-content">
            <span class="item-name" title={tpl.template.name}>{tpl.template.name}</span>
            <span class="item-meta">{tpl.scope}</span>
          </span>
        </button>
      {/each}
      {#if state.templates.length === 0}
        <div class="empty-state-cta">
          <p>No templates yet</p>
          <div class="empty-actions">
            <button type="button" class="btn btn-sm btn-secondary" onclick={newTemplate}>
              <Icon name="add" size={12} />
              <span>Create template</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
  </section>

  <section class="detail-region" aria-label="Template editor">
    {#if currentEntity.type === 'template' && currentEntity.id}
      <TemplateDetail templateId={currentEntity.id} />
    {:else if currentEntity.type === 'new-template'}
      <TemplateDetail />
    {:else}
      <div class="placeholder">
        <Icon name="file-code" size={40} />
        <p>Select a template or create a new one.</p>
      </div>
    {/if}
  </section>
</div>

<style>
  .templates-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .list-region {
    flex-shrink: 0;
    max-height: 42%;
    overflow-y: auto;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-bold);
    color: var(--vscode-sideBarTitle-foreground);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: sticky;
    top: 0;
    background: var(--vscode-sideBar-background);
    z-index: 1;
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-xs);
  }

  .icon-button {
    background: none;
    border: none;
    color: var(--vscode-icon-foreground);
    cursor: pointer;
    padding: var(--jsm-space-2xs);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--jsm-radius-sm);
    transition:
      background-color var(--jsm-transition-fast),
      color var(--jsm-transition-fast);
  }

  .icon-button:hover {
    background: var(--jsm-color-bg-hover);
    color: var(--jsm-color-primary-fg);
  }

  .icon-button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }

  .section-list {
    display: flex;
    flex-direction: column;
    padding-bottom: var(--jsm-space-sm);
  }

  .list-item {
    display: flex;
    align-items: center;
    padding: var(--jsm-space-xs) var(--jsm-space-md) var(--jsm-space-xs) var(--jsm-space-xl);
    cursor: pointer;
    color: var(--vscode-sideBar-foreground);
    font-size: var(--jsm-font-size-md);
    transition: background-color var(--jsm-transition-fast);
    width: 100%;
    background: none;
    border: none;
    text-align: left;
  }

  .list-item:hover {
    background: var(--jsm-color-bg-hover);
  }

  .list-item.active {
    background: var(--jsm-color-bg-active);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .list-item:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }

  .item-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .item-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-meta {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
  }

  .empty-state-cta {
    padding: var(--jsm-space-md) var(--jsm-space-lg);
    text-align: center;
  }

  .empty-state-cta p {
    margin: 0 0 var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
  }

  .empty-actions {
    display: flex;
    justify-content: center;
    gap: var(--jsm-space-sm);
  }

  .btn-sm {
    display: inline-flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
    border-radius: var(--jsm-radius-sm);
    border: none;
    cursor: pointer;
    font-family: var(--jsm-font-family);
  }

  .btn-secondary {
    background: var(--jsm-color-secondary);
    color: var(--jsm-color-secondary-fg);
  }

  .detail-region {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    background: var(--jsm-color-bg);
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--jsm-space-md);
    height: 100%;
    min-height: 160px;
    padding: var(--jsm-space-xl);
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-md);
    text-align: center;
  }

  .placeholder p {
    margin: 0;
    max-width: 280px;
    line-height: var(--jsm-line-height-relaxed);
  }
</style>

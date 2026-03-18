<script lang="ts">
  import { onDestroy } from 'svelte';
  import { spaState, activeEntity } from '../../stores';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../Icon.svelte';

  let state = $state($spaState);
  const unsubscribeSpaState = spaState.subscribe(s => { state = s; });

  let currentEntity = $state($activeEntity);
  const unsubscribeActiveEntity = activeEntity.subscribe(e => { currentEntity = e; });

  onDestroy(() => {
    unsubscribeSpaState();
    unsubscribeActiveEntity();
  });

  let showStatus = $derived(state.settings?.showStatusInSidebar ?? true);
  let showWorkspaceNames = $derived(state.workspaceFolders.length > 1);

  function selectEntity(target: { type: 'welcome' | 'server' | 'template' | 'settings' | 'new-server' | 'new-template'; id?: string }) {
    activeEntity.set(target);
  }

  function getStatusIcon(state: string): IconName {
    switch (state) {
      case 'running': return 'circle-filled';
      case 'starting': return 'loading';
      case 'stopping': return 'loading';
      case 'error': return 'error';
      default: return 'circle';
    }
  }

  function getStatusColor(state: string): string {
    switch (state) {
      case 'running': return 'var(--jsm-status-running)';
      case 'starting':
      case 'stopping':
        return 'var(--jsm-status-starting)';
      case 'error':
        return 'var(--jsm-status-error)';
      default:
        return 'var(--jsm-status-stopped)';
    }
  }
</script>

<div class="sidebar">
  <div class="sidebar-content">
    <button
      type="button"
      class="list-item overview-item"
      class:active={currentEntity.type === 'welcome'}
      onclick={() => selectEntity({ type: 'welcome' })}
    >
      <Icon name="layout" size={14} />
      <span class="item-name">Overview</span>
    </button>

    <div class="sidebar-divider"></div>

    <!-- SERVERS -->
    <div class="section">
      <div class="section-title">
        <span class="section-label">
          <Icon name="server" size={14} />
          <span>SERVERS</span>
        </span>
        <button type="button" class="icon-button" aria-label="Add server" title="Add Server" onclick={() => selectEntity({ type: 'new-server' })}>
          <Icon name="add" size={14} />
        </button>
      </div>
      <div class="section-list">
        {#each state.servers as server}
          <button
            type="button"
            class="list-item"
            class:active={currentEntity.type === 'server' && currentEntity.id === server.config.id}
            onclick={() => selectEntity({ type: 'server', id: server.config.id })}
          >
            {#if showStatus}
              <span class="status-icon" style="color: {getStatusColor(state.runtimeStates[server.serverKey]?.state)}">
                <Icon name={getStatusIcon(state.runtimeStates[server.serverKey]?.state)} size={12} />
              </span>
            {/if}
            <span class="item-content">
              <span class="item-name" title={server.config.name}>{server.config.name}</span>
              {#if showWorkspaceNames}
                <span class="item-meta">{server.workspaceFolderName}</span>
              {/if}
            </span>
          </button>
        {/each}
        {#if state.servers.length === 0}
          <div class="empty-state-cta">
            <p>No servers configured</p>
            <div class="empty-actions">
              <button type="button" class="btn btn-sm btn-primary" onclick={() => selectEntity({ type: 'new-server' })}>
                <Icon name="add" size={12} />
                <span>Add Server</span>
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- TEMPLATES -->
    <div class="section">
      <div class="section-title">
        <span class="section-label">
          <Icon name="file-code" size={14} />
          <span>TEMPLATES</span>
        </span>
        <button type="button" class="icon-button" aria-label="Create template" title="Create Template" onclick={() => selectEntity({ type: 'new-template' })}>
          <Icon name="add" size={14} />
        </button>
      </div>
      <div class="section-list">
        {#each state.templates as tpl}
          <button
            type="button"
            class="list-item"
            class:active={currentEntity.type === 'template' && currentEntity.id === tpl.template.id}
            onclick={() => selectEntity({ type: 'template', id: tpl.template.id })}
          >
            <span class="item-content">
              <span class="item-name" title={tpl.template.name}>{tpl.template.name}</span>
              <span class="item-meta">{tpl.scope}</span>
            </span>
          </button>
        {/each}
        {#if state.templates.length === 0}
          <div class="empty-state-cta">
            <p>No templates configured</p>
            <div class="empty-actions">
              <button type="button" class="btn btn-sm btn-secondary" onclick={() => selectEntity({ type: 'new-template' })}>
                <Icon name="add" size={12} />
                <span>Add Template</span>
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- SETTINGS -->
    <div class="section">
      <div class="section-title">
        <span class="section-label">
          <Icon name="settings" size={14} />
          <span>SETTINGS</span>
        </span>
      </div>
      <div class="section-list">
        <button
          type="button"
          class="list-item"
          class:active={currentEntity.type === 'settings'}
          onclick={() => selectEntity({ type: 'settings' })}
        >
          <span class="item-name">Global Config</span>
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: var(--jsm-sidebar-width);
    background: var(--jsm-sidebar-bg);
    border-right: 1px solid var(--jsm-sidebar-border);
  }
  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--jsm-space-sm) 0;
  }
  .overview-item {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-sm) var(--jsm-space-md) var(--jsm-space-sm) var(--jsm-space-lg);
    margin: 0 var(--jsm-space-sm);
    border-radius: var(--jsm-radius-sm);
    background: transparent;
    border: none;
    color: var(--jsm-color-fg);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    cursor: pointer;
    transition: background-color var(--jsm-transition-fast);
    width: calc(100% - var(--jsm-space-sm) * 2);
    text-align: left;
  }
  .overview-item:hover {
    background: var(--jsm-color-bg-hover);
  }
  .overview-item.active {
    background: var(--jsm-color-bg-active);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .sidebar-divider {
    height: 1px;
    background: var(--jsm-color-border);
    margin: var(--jsm-space-sm) var(--jsm-space-md);
  }
  .section {
    margin-bottom: var(--jsm-space-sm);
  }
  .section-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--jsm-space-xs) var(--jsm-space-md) var(--jsm-space-xs) var(--jsm-space-lg);
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-bold);
    color: var(--vscode-sideBarTitle-foreground);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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
    transition: background-color var(--jsm-transition-fast), color var(--jsm-transition-fast);
  }
  .icon-button:hover {
    background: var(--jsm-color-bg-hover);
    color: var(--jsm-color-primary-fg);
  }
  .section-list {
    display: flex;
    flex-direction: column;
    margin-top: var(--jsm-space-xs);
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
  .status-icon {
    margin-right: var(--jsm-space-sm);
    display: flex;
    align-items: center;
  }
  .item-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .item-meta {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
  }
  .empty-text {
    padding: var(--jsm-space-xs) var(--jsm-space-md) var(--jsm-space-xs) var(--jsm-space-xl);
    font-style: italic;
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-sm);
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
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
  }
  .btn-primary {
    background: var(--jsm-color-primary);
    color: var(--jsm-color-primary-fg);
  }
  .btn-secondary {
    background: var(--jsm-color-secondary);
    color: var(--jsm-color-secondary-fg);
  }
</style>

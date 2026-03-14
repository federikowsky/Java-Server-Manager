<script lang="ts">
  import { spaState, activeEntity } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../Icon.svelte';

  let state = $state($spaState);
  spaState.subscribe(s => { state = s; });

  let currentEntity = $state($activeEntity);
  activeEntity.subscribe(e => { currentEntity = e; });

  function selectEntity(type: 'server' | 'template' | 'settings' | 'new-server' | 'new-template', id?: string) {
    activeEntity.set({ type, id });
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
      case 'starting': case 'stopping': return 'var(--jsm-status-starting)';
      case 'error': return 'var(--jsm-status-error)';
      default: return 'var(--jsm-status-stopped)';
    }
  }

  function handleAutodiscover() {
    postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'executeCommand', id: 'jsm.server.autodiscover' });
  }
</script>

<div class="sidebar">
  <div class="sidebar-header">
    <div class="global-actions">
      <button class="action-btn" title="Autodiscover Servers" onclick={handleAutodiscover}>
        <Icon name="search" size={14} />
        <span>Autodiscover</span>
      </button>
    </div>
  </div>

  <div class="sidebar-content">
    <!-- SERVERS -->
    <div class="section">
      <div class="section-title">
        <span class="section-label">
          <Icon name="server" size={14} />
          <span>SERVERS</span>
        </span>
        <button class="icon-button" title="Add Server" onclick={() => selectEntity('new-server')}>
          <Icon name="add" size={14} />
        </button>
      </div>
      <div class="section-list">
        {#each state.servers as server}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div 
            class="list-item" 
            class:active={currentEntity.type === 'server' && currentEntity.id === server.config.id}
            onclick={() => selectEntity('server', server.config.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && selectEntity('server', server.config.id)}
          >
            <span class="status-icon" style="color: {getStatusColor(state.runtimeStates[server.config.id]?.state)}">
              <Icon name={getStatusIcon(state.runtimeStates[server.config.id]?.state)} size={12} />
            </span>
            <span class="item-name" title={server.config.name}>{server.config.name}</span>
          </div>
        {/each}
        {#if state.servers.length === 0}
          <div class="empty-text">No servers configured</div>
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
        <button class="icon-button" title="Create Template" onclick={() => selectEntity('new-template')}>
          <Icon name="add" size={14} />
        </button>
      </div>
      <div class="section-list">
        {#each state.templates as tpl}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div 
            class="list-item" 
            class:active={currentEntity.type === 'template' && currentEntity.id === tpl.template.id}
            onclick={() => selectEntity('template', tpl.template.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && selectEntity('template', tpl.template.id)}
          >
            <span class="item-name" title={tpl.template.name}>{tpl.template.name}</span>
          </div>
        {/each}
        {#if state.templates.length === 0}
          <div class="empty-text">No templates configured</div>
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
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div 
          class="list-item" 
          class:active={currentEntity.type === 'settings'}
          onclick={() => selectEntity('settings')}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && selectEntity('settings')}
        >
          <span class="item-name">Global Config</span>
        </div>
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
  .sidebar-header {
    padding: var(--jsm-space-md);
    border-bottom: 1px solid var(--jsm-color-border);
  }
  .global-actions {
    display: flex;
    gap: var(--jsm-space-sm);
  }
  .action-btn {
    flex: 1;
    background: var(--jsm-color-secondary);
    color: var(--jsm-color-secondary-fg);
    border: 1px solid var(--jsm-color-border-secondary);
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    border-radius: var(--jsm-radius-sm);
    cursor: pointer;
    font-size: var(--jsm-font-size-sm);
    font-family: var(--jsm-font-family);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--jsm-space-xs);
    transition: background-color var(--jsm-transition-fast);
  }
  .action-btn:hover {
    background: var(--jsm-color-secondary-hover);
  }
  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--jsm-space-md) 0;
  }
  .section {
    margin-bottom: var(--jsm-space-lg);
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
  .empty-text {
    padding: var(--jsm-space-xs) var(--jsm-space-md) var(--jsm-space-xs) var(--jsm-space-xl);
    font-style: italic;
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-sm);
  }
</style>
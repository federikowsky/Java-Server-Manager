<script lang="ts">
  import { activeEntity, spaState } from '../../stores';
  import type { ActiveEntity } from '../../stores';
  import ServerDetail from './ServerDetail.svelte';
  import TemplateDetail from './TemplateDetail.svelte';
  import SettingsView from './SettingsView.svelte';
  import ServerWizard from './forms/ServerWizard.svelte';
  import DeploymentWizard from './forms/DeploymentWizard.svelte';
  import Icon from '../Icon.svelte';

  let currentEntity = $state<ActiveEntity>($activeEntity);
  activeEntity.subscribe(e => { currentEntity = e; });

  let state = $state($spaState);
  spaState.subscribe(s => { state = s; });

  function selectEntity(type: 'new-server' | 'new-template') {
    activeEntity.set({ type });
  }
</script>

<div class="detail-content">
  {#if currentEntity.type === 'server'}
    {#if currentEntity.id}
      <ServerDetail serverId={currentEntity.id} />
    {:else}
      <div class="empty-state">Error: No server ID</div>
    {/if}
  {:else if currentEntity.type === 'new-server'}
    <ServerWizard templateId={currentEntity.templateId} />
  {:else if currentEntity.type === 'deployment'}
    {#if currentEntity.serverId}
      <DeploymentWizard
        serverId={currentEntity.serverId}
        deploymentId={currentEntity.id}
        mode={currentEntity.mode || 'create'}
      />
    {:else}
      <div class="empty-state">Error: No server ID for deployment</div>
    {/if}
  {:else if currentEntity.type === 'template'}
    {#if currentEntity.id}
      <TemplateDetail templateId={currentEntity.id} />
    {:else}
      <div class="empty-state">Error: No template ID</div>
    {/if}
  {:else if currentEntity.type === 'new-template'}
    <TemplateDetail />
  {:else if currentEntity.type === 'settings'}
    <SettingsView />
  {:else}
    <div class="welcome-state">
      <div class="welcome-content">
        <Icon name="server" size={48} />
        <h2>Welcome to Java Server Manager</h2>
        <p>Select a server from the sidebar, or create a new one to get started.</p>
        <div class="welcome-actions">
          <button class="btn btn-primary" onclick={() => selectEntity('new-server')}>
            <Icon name="add" size={14} />
            <span>Add Server</span>
          </button>
          <button class="btn btn-secondary" onclick={() => selectEntity('new-template')}>
            <Icon name="file-code" size={14} />
            <span>Create Template</span>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .detail-content {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
  }
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-md);
  }
  .welcome-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--jsm-space-2xl);
  }
  .welcome-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--jsm-space-md);
    text-align: center;
    max-width: 400px;
    color: var(--jsm-color-fg-secondary);
  }
  .welcome-content h2 {
    margin: 0;
    font-size: var(--jsm-font-size-2xl);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }
  .welcome-content p {
    margin: 0;
    line-height: var(--jsm-line-height-relaxed);
  }
  .welcome-actions {
    display: flex;
    gap: var(--jsm-space-sm);
    margin-top: var(--jsm-space-md);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    border-radius: var(--jsm-radius-sm);
    font-size: var(--jsm-font-size-md);
    font-family: var(--jsm-font-family);
    font-weight: var(--jsm-font-weight-semibold);
    cursor: pointer;
    border: none;
    transition: background-color var(--jsm-transition-fast);
  }
  .btn-primary {
    background: var(--jsm-color-primary);
    color: var(--jsm-color-primary-fg);
  }
  .btn-primary:hover {
    background: var(--jsm-color-primary-hover);
  }
  .btn-secondary {
    background: var(--jsm-color-secondary);
    color: var(--jsm-color-secondary-fg);
  }
  .btn-secondary:hover {
    background: var(--jsm-color-secondary-hover);
  }
</style>

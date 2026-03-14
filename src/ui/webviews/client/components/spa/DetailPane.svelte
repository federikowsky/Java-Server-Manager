<script lang="ts">
  import { activeEntity } from '../../stores';
  import type { ActiveEntity } from '../../stores';
  import ServerDetail from './ServerDetail.svelte';
  import TemplateDetail from './TemplateDetail.svelte';
  import DeploymentForm from './DeploymentForm.svelte';
  import NewServerForm from './NewServerForm.svelte';
  import SettingsView from './SettingsView.svelte';

  let currentEntity = $state<ActiveEntity>($activeEntity);
  activeEntity.subscribe(e => { currentEntity = e; });
</script>

<div class="detail-content">
  {#if currentEntity.type === 'server'}
    {#if currentEntity.id}
      <ServerDetail serverId={currentEntity.id} />
    {:else}
      <div class="empty-state">Error: No server ID</div>
    {/if}
  {:else if currentEntity.type === 'new-server'}
    <NewServerForm />
  {:else if currentEntity.type === 'deployment'}
    {#if currentEntity.serverId}
      <DeploymentForm
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
    <div class="empty-state">
      <p>Select an item from the sidebar to view details</p>
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
    color: var(--vscode-descriptionForeground);
    font-size: 14px;
  }
  .placeholder {
    padding: 24px;
    color: var(--vscode-foreground);
  }
  .placeholder h2 {
    margin-top: 0;
    font-weight: 500;
    font-size: 1.5em;
    border-bottom: 1px solid var(--vscode-panel-border);
    padding-bottom: 12px;
    margin-bottom: 20px;
  }
</style>
<script lang="ts">
  import { activeEntity, spaState } from '../../stores';
  import type { ActiveEntity } from '../../stores';
  import ServerDetail from './ServerDetail.svelte';
  import ServerWizard from './forms/ServerWizard.svelte';
  import DeploymentWizard from './forms/DeploymentWizard.svelte';
  import HomeWelcome from './HomeWelcome.svelte';
  import HooksEditorPage from './HooksEditorPage.svelte';

  let currentEntity = $state<ActiveEntity>($activeEntity);
  activeEntity.subscribe(e => {
    currentEntity = e;
  });

  function selectEntity(type: 'new-server' | 'new-template') {
    if (type === 'new-template') {
      spaState.update(s => ({ ...s, globalTab: 'templates' }));
      activeEntity.set({ type: 'new-template' });
      return;
    }
    activeEntity.set({ type });
  }

  function browseTemplatesFromHome() {
    spaState.update(s => ({ ...s, globalTab: 'templates' }));
    activeEntity.set({ type: 'welcome' });
  }
</script>

<div class="detail-content">
  {#if currentEntity.type === 'server'}
    {#if currentEntity.id}
      <ServerDetail
        serverKey={currentEntity.serverKey ?? currentEntity.id}
        serverId={currentEntity.serverId}
        workspaceFolderUri={currentEntity.workspaceFolderUri}
      />
    {:else}
      <div class="empty-state">Error: No server ID</div>
    {/if}
  {:else if currentEntity.type === 'new-server'}
    <ServerWizard templateId={currentEntity.templateId} />
  {:else if currentEntity.type === 'hooks-editor'}
    <HooksEditorPage />
  {:else if currentEntity.type === 'deployment'}
    {#if currentEntity.serverId}
      <DeploymentWizard
        serverId={currentEntity.serverId}
        serverKey={currentEntity.serverKey}
        workspaceFolderUri={currentEntity.workspaceFolderUri}
        deploymentId={currentEntity.id}
        mode={currentEntity.mode || 'create'}
      />
    {:else}
      <div class="empty-state">Error: No server ID for deployment</div>
    {/if}
  {:else}
    <HomeWelcome onAddServer={() => selectEntity('new-server')} onBrowseTemplates={browseTemplatesFromHome} />
  {/if}
</div>

<style>
  .detail-content {
    flex: 1;
    min-height: 0;
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
</style>

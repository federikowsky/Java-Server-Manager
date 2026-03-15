<script lang="ts">
  import { spaState, activeEntity } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import Icon from '../Icon.svelte';

  const { serverId }: { serverId: string } = $props();

  let state = $state($spaState);
  spaState.subscribe(s => { state = s; });

  let serverRecord = $derived(state.servers.find(s => s.config.id === serverId));
  let config = $derived(serverRecord?.config);
  let deployments = $derived(config?.deployments || []);

  // Deployment states for this server
  let depStates = $derived(serverRecord ? (state.deploymentStates?.[serverRecord.serverKey] || {}) : {});
  function isDeploying(depId: string): boolean {
    return depStates[depId] === 'deploying';
  }

  function handleAction(cmd: string, deployment: any) {
    const workspaceFolderUri = serverRecord?.workspaceFolderUri;
    const serverKey = serverRecord?.serverKey ?? (workspaceFolderUri ? `${workspaceFolderUri}::${serverId}` : serverId);
    postToHost({ 
      v: WEBVIEW_PROTOCOL_VERSION, 
      command: 'executeCommand', 
      id: cmd, 
      args: [{ 
        serverId, 
        serverKey,
        deploymentId: deployment.id,
        deploymentConfig: deployment,
        workspaceFolderUri,
        workspaceFolderName: serverRecord?.workspaceFolderName
      }] 
    });
  }

  function handleAddDeployment() {
    // Navigate to inline deployment form in SPA
    activeEntity.set({ type: 'deployment', serverId, mode: 'create' });
  }

  function handleEditDeployment(deploymentId: string) {
    // Navigate to inline deployment form in SPA
    activeEntity.set({ type: 'deployment', id: deploymentId, serverId, mode: 'edit' });
  }
</script>

<div class="deployments-view">
  <div class="toolbar">
    <button type="button" class="btn btn-primary" onclick={handleAddDeployment}>
      <Icon name="add" size={14} />
      <span>Add Deployment</span>
    </button>
  </div>
  
  <table class="data-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Type</th>
        <th>Source</th>
        <th>Sync</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each deployments as dep}
        <tr>
          <td><strong>{dep.deployName}</strong></td>
          <td>
            <span class="type-badge" class:war={dep.type === 'war'} class:exploded={dep.type === 'exploded'}>
              {#if dep.type === 'war'}
                <Icon name="package" size={12} />
                <span>WAR</span>
              {:else}
                <Icon name="folder-open" size={12} />
                <span>Exploded</span>
              {/if}
            </span>
          </td>
          <td class="path-cell" title={dep.sourcePath}>{dep.sourcePath}</td>
          <td>
            <span class="sync-badge {dep.syncMode}">
              {dep.syncMode}
            </span>
            {#if dep.type === 'exploded' && dep.hotReload}
              <span class="hotreload-badge" title="Hot Reload Enabled">
                <Icon name="flame" size={12} />
              </span>
            {/if}
          </td>
          <td class="actions-cell">
            {#if isDeploying(dep.id)}
              <span class="deploying-indicator" title="Deployment in progress">
                <Icon name="loading" size={14} />
              </span>
            {:else}
              <button type="button" aria-label={`Redeploy ${dep.deployName}`} title="Redeploy" class="icon-btn" onclick={() => handleAction('jsm.deployment.redeploy', dep)}>
                <Icon name="refresh" size={14} />
              </button>
              <button type="button" aria-label={`Undeploy ${dep.deployName}`} title="Undeploy" class="icon-btn" onclick={() => handleAction('jsm.deployment.undeploy', dep)}>
                <Icon name="undeploy" size={14} />
              </button>
            {/if}
            <button type="button" aria-label={`Edit ${dep.deployName}`} title="Edit" class="icon-btn" onclick={() => handleEditDeployment(dep.id)}>
              <Icon name="edit" size={14} />
            </button>
            <button type="button" aria-label={`Open logs for ${dep.deployName}`} title="Logs" class="icon-btn" onclick={() => handleAction('jsm.deployment.openLogs', dep)}>
              <Icon name="terminal" size={14} />
            </button>
            <button type="button" aria-label={`Remove ${dep.deployName}`} title="Remove" class="icon-btn danger" onclick={() => handleAction('jsm.deployment.remove', dep)} disabled={isDeploying(dep.id)}>
              <Icon name="trash" size={14} />
            </button>
          </td>
        </tr>
      {/each}
      {#if deployments.length === 0}
        <tr>
          <td colspan="5" class="empty-row">No deployments configured yet. Add one to enable deploy, undeploy, and health checks.</td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>

<style>
  .toolbar {
    margin-bottom: var(--jsm-space-lg);
    display: flex;
    justify-content: flex-end;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    background: var(--jsm-color-bg-tertiary);
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-md);
    overflow: hidden;
  }
  
  .data-table th, .data-table td {
    padding: var(--jsm-space-md) var(--jsm-space-lg);
    border-bottom: 1px solid var(--jsm-color-border);
  }
  
  .data-table th {
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
    background: var(--vscode-editorGroupHeader-tabsBackground);
    font-size: var(--jsm-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .data-table tr:last-child td {
    border-bottom: none;
  }
  
  .data-table tr:hover td {
    background: var(--jsm-color-bg-hover);
  }

  .type-badge, .sync-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--jsm-space-2xs);
    padding: var(--jsm-space-2xs) var(--jsm-space-xs);
    border-radius: var(--jsm-radius-sm);
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-medium);
  }

  .type-badge.war {
    background: rgba(81, 154, 186, 0.2);
    color: var(--jsm-color-info);
  }

  .type-badge.exploded {
    background: rgba(200, 140, 50, 0.2);
    color: var(--vscode-terminal-ansiYellow);
  }

  .sync-badge.auto {
    color: var(--jsm-status-running);
  }

  .sync-badge.manual {
    color: var(--jsm-color-fg-secondary);
  }

  .hotreload-badge {
    margin-left: var(--jsm-space-xs);
    cursor: help;
    display: inline-flex;
    color: var(--jsm-status-starting);
  }
  
  .path-cell {
    max-width: 250px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--jsm-font-size-sm);
    color: var(--vscode-textPreformat-foreground);
  }
  
  .actions-cell {
    display: flex;
    gap: var(--jsm-space-2xs);
  }
  
  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--jsm-space-xs);
    border-radius: var(--jsm-radius-sm);
    opacity: 0.7;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--jsm-color-fg);
    transition: background-color var(--jsm-transition-fast), opacity var(--jsm-transition-fast);
  }
  
  .icon-btn:hover {
    background: var(--jsm-color-secondary);
    opacity: 1;
  }

  .icon-btn.danger:hover {
    background: var(--jsm-color-error);
    color: white;
  }

  .icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .deploying-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--jsm-space-xs);
    color: var(--jsm-status-starting);
  }

  .empty-row {
    text-align: center;
    color: var(--jsm-color-fg-secondary);
    padding: var(--jsm-space-2xl) !important;
    font-style: italic;
  }
</style>

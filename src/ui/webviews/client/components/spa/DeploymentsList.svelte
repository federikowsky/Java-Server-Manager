<script lang="ts">
  import type { DeploymentConfig, ServerConfig } from '@core/types';
  import { spaState, activeEntity } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import Icon from '../Icon.svelte';
  import SectionBlock from '../ds/SectionBlock.svelte';

  const { serverId }: { serverId: string } = $props();

  let state = $state($spaState);
  spaState.subscribe(s => {
    state = s;
  });

  let serverRecord = $derived(state.servers.find(s => (s.config as ServerConfig).id === serverId));
  let config = $derived(serverRecord ? (serverRecord.config as ServerConfig) : undefined);
  let deployments = $derived(config?.deployments || []);

  let depStates = $derived(serverRecord ? (state.deploymentStates?.[serverRecord.serverKey] || {}) : {});

  function isDeploying(depId: string): boolean {
    return depStates[depId] === 'deploying';
  }

  function formatStatus(raw: string | undefined): string {
    if (!raw) return '—';
    switch (raw) {
      case 'synced':
        return 'Healthy';
      case 'undeployed':
        return 'Undeployed';
      case 'error':
        return 'Error';
      case 'deploying':
        return 'Deploying';
      default:
        return raw;
    }
  }

  function handleAction(cmd: string, deployment: DeploymentConfig) {
    const workspaceFolderUri = serverRecord?.workspaceFolderUri;
    const serverKey = serverRecord?.serverKey ?? (workspaceFolderUri ? `${workspaceFolderUri}::${serverId}` : serverId);
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: cmd,
      args: [
        {
          serverId,
          serverKey,
          deploymentId: deployment.id,
          deploymentConfig: deployment,
          workspaceFolderUri,
          workspaceFolderName: serverRecord?.workspaceFolderName,
        },
      ],
    });
  }

  function handleAddDeployment() {
    activeEntity.set({ type: 'deployment', serverId, mode: 'create' });
  }

  function handleEditDeployment(deploymentId: string) {
    activeEntity.set({ type: 'deployment', id: deploymentId, serverId, mode: 'edit' });
  }
</script>

<div class="deployments-view jsm-stack-lg">
  <header class="dep-page-head">
    <h2 class="jsm-type-page-title">Deployments</h2>
    <button type="button" class="btn-primary" onclick={handleAddDeployment}>Add Deployment</button>
  </header>

  {#if deployments.length === 0}
    <SectionBlock title="Deployments">
      <p class="empty-title">No deployments configured</p>
      <p class="empty-desc">Add a deployment to start syncing or redeploying artifacts</p>
      <button type="button" class="btn-primary empty-add" onclick={handleAddDeployment}>Add Deployment</button>
    </SectionBlock>
  {:else}
    <div class="table-wrap jsm-surface-section" role="region" aria-label="Deployments table">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Source</th>
            <th>Sync</th>
            <th>Status</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each deployments as dep}
            <tr>
              <td class="cell-name">{dep.deployName}</td>
              <td>
                <span class="type-label" class:war={dep.type === 'war'}>
                  {dep.type === 'war' ? 'WAR' : 'Exploded'}
                </span>
              </td>
              <td class="path-cell" title={dep.sourcePath}>{dep.sourcePath}</td>
              <td>
                <span class="sync-label {dep.syncMode}">{dep.syncMode}</span>
                {#if dep.type === 'exploded' && dep.hotReload}
                  <span class="hot-hint" title="Hot reload enabled">
                    <Icon name="flame" size={12} />
                  </span>
                {/if}
              </td>
              <td class="status-cell">{formatStatus(depStates[dep.id])}</td>
              <td class="actions-cell">
                {#if isDeploying(dep.id)}
                  <span class="deploying-indicator" title="Deployment in progress">
                    <Icon name="loading" size={14} />
                  </span>
                {:else}
                  <!-- Spec §17.3 / §42.4: ↻ ↓ Edit >_ 🗑 -->
                  <button
                    type="button"
                    class="act-icon"
                    aria-label="Redeploy"
                    title="Redeploy"
                    onclick={() => handleAction('jsm.deployment.redeploy', dep)}
                  >
                    <Icon name="refresh" size={14} />
                  </button>
                  <button
                    type="button"
                    class="act-icon"
                    aria-label="Reveal source in explorer"
                    title="Reveal source"
                    onclick={() => handleAction('jsm.deployment.revealSource', dep)}
                  >
                    <Icon name="download" size={14} />
                  </button>
                {/if}
                <button type="button" class="act-text" onclick={() => handleEditDeployment(dep.id)}>
                  Edit
                </button>
                <button
                  type="button"
                  class="act-icon"
                  aria-label="Logs"
                  title="Logs"
                  onclick={() => handleAction('jsm.deployment.openLogs', dep)}
                >
                  <Icon name="terminal" size={14} />
                </button>
                <button
                  type="button"
                  class="act-icon danger"
                  aria-label="Remove"
                  title="Remove"
                  onclick={() => handleAction('jsm.deployment.remove', dep)}
                  disabled={isDeploying(dep.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <p class="footnote jsm-type-meta">
    Sync mode controls redeploy behavior. Open Edit to configure health checks and ignore patterns.
  </p>
</div>

<style>
  .deployments-view {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-md);
    min-height: 0;
  }

  .dep-page-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--jsm-space-lg);
    flex-wrap: wrap;
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

  .empty-title {
    margin: 0 0 var(--jsm-space-xs);
    font-size: var(--jsm-font-size-md);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }

  .empty-desc {
    margin: 0;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
    line-height: var(--jsm-line-height-relaxed);
  }

  .empty-add {
    margin-top: var(--jsm-space-md);
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

  .data-table th,
  .data-table td {
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    border-bottom: 1px solid var(--jsm-color-border-secondary);
    text-align: left;
    vertical-align: middle;
  }

  .data-table th {
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: color-mix(in srgb, var(--jsm-surface-1) 80%, transparent);
  }

  .data-table tbody tr:hover td {
    background: var(--jsm-color-bg-hover);
  }

  .col-actions {
    width: 1%;
    white-space: nowrap;
    min-width: 11.5rem;
  }

  .cell-name {
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }

  .path-cell {
    max-width: 14rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--vscode-editor-font-family, var(--jsm-font-family));
    font-size: var(--jsm-font-size-sm);
    color: var(--vscode-textPreformat-foreground, var(--jsm-color-fg));
  }

  .type-label {
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--jsm-color-fg-secondary);
  }

  .type-label.war {
    color: var(--jsm-color-info);
  }

  .sync-label {
    text-transform: capitalize;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
  }

  .sync-label.auto {
    color: var(--jsm-status-running);
  }

  .hot-hint {
    margin-left: var(--jsm-space-xs);
    display: inline-flex;
    vertical-align: middle;
    color: var(--jsm-status-starting);
  }

  .status-cell {
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg);
  }

  .actions-cell {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--jsm-space-2xs);
  }

  .act-icon,
  .act-text {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    gap: var(--jsm-space-2xs);
    padding: var(--jsm-space-2xs) var(--jsm-space-xs);
    border: none;
    border-radius: var(--jsm-radius-xs);
    background: transparent;
    color: var(--jsm-color-fg);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-sm);
    cursor: pointer;
  }

  .act-icon:hover,
  .act-text:hover {
    background: var(--jsm-color-bg-hover);
  }

  .act-icon.danger:hover {
    color: var(--jsm-color-error);
  }

  .act-icon:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .deploying-indicator {
    display: inline-flex;
    color: var(--jsm-status-starting);
    padding: var(--jsm-space-2xs);
  }

  .footnote {
    margin: 0;
    max-width: 48rem;
  }
</style>

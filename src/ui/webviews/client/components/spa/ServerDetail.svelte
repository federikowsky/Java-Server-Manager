<script lang="ts">
  import { spaState, formData, formId } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import FormBody from '../FormBody.svelte';
  import FormActions from '../FormActions.svelte';
  import DeploymentsList from './DeploymentsList.svelte';
  import Icon from '../Icon.svelte';

  const { serverId }: { serverId: string } = $props();

  let state = $state($spaState);
  spaState.subscribe(s => { state = s; });

  let serverRecord = $derived(state.servers.find(s => s.config.id === serverId));
  let config = $derived(serverRecord?.config);
  let runtimeState = $derived(state.runtimeStates[serverId]);

  let activeTab = $state('overview');

  // Reactively request the form schema and prep the global form store
  // when the 'config' tab is active for this server.
  $effect(() => {
    if (activeTab === 'config' && config) {
      postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'executeCommand', id: 'jsm.internal.requestServerSchema', args: ['edit', serverId] });
    }
  });

  function handleAction(cmd: string) {
    const workspaceFolderUri = serverRecord?.workspaceFolderUri;
    // serverKey is constructed the same way as makeWorkspaceServerKey
    const serverKey = workspaceFolderUri ? `${workspaceFolderUri}::${serverId}` : serverId;
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: cmd,
      args: [{ 
        serverId, 
        serverKey,
        workspaceFolderUri,
        workspaceFolderName: serverRecord?.workspaceFolderName 
      }],
    });
  }
</script>

{#if config}
  <div class="server-detail">
    <!-- Header -->
    <div class="header">
      <div class="header-main">
        <h1>{config.name}</h1>
        <span class="badge {runtimeState?.state || 'stopped'}">
          {runtimeState?.state || 'stopped'}
        </span>
      </div>
      <div class="header-actions">
        {#if runtimeState?.state === 'stopped' || runtimeState?.state === 'error'}
          <button class="action-btn primary" onclick={() => handleAction('jsm.server.startRun')}>
            <Icon name="play" size={14} />
            <span>Start</span>
          </button>
          <button class="action-btn" onclick={() => handleAction('jsm.server.startDebug')}>
            <Icon name="debug" size={14} />
            <span>Debug</span>
          </button>
        {:else if runtimeState?.state === 'running'}
          <button class="action-btn" onclick={() => handleAction('jsm.server.restartRun')}>
            <Icon name="refresh" size={14} />
            <span>Restart</span>
          </button>
          <button class="action-btn danger" onclick={() => handleAction('jsm.server.stop')}>
            <Icon name="stop" size={14} />
            <span>Stop</span>
          </button>
        {/if}
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button class="tab" class:active={activeTab === 'overview'} onclick={() => activeTab = 'overview'}>
        <Icon name="info" size={14} />
        <span>Overview</span>
      </button>
      <button class="tab" class:active={activeTab === 'config'} onclick={() => activeTab = 'config'}>
        <Icon name="settings" size={14} />
        <span>Configuration</span>
      </button>
      <button class="tab" class:active={activeTab === 'deployments'} onclick={() => activeTab = 'deployments'}>
        <Icon name="package" size={14} />
        <span>Deployments ({config.deployments?.length || 0})</span>
      </button>
    </div>

    <!-- Tab Content -->
    <div class="tab-content">
      {#if activeTab === 'overview'}
        <div class="config-grid">
          <div class="config-section">
            <h3>Server Identity</h3>
            <div class="field-row">
              <label>Name:</label>
              <input type="text" value={config.name} readonly class="readonly-input" />
            </div>
            <div class="field-row">
              <label>Type:</label>
              <input type="text" value={config.type} readonly class="readonly-input" />
            </div>
            <div class="field-row">
              <label>Home:</label>
              <input type="text" value={config.runtime?.homePath} readonly class="readonly-input" />
            </div>
          </div>

          <div class="config-section">
            <h3>Ports & Network</h3>
            <div class="field-row">
              <label>HTTP Port:</label>
              <input type="text" value={config.ports?.http} readonly class="readonly-input" />
            </div>
            <div class="field-row">
              <label>Debug Port:</label>
              <input type="text" value={config.ports?.debug ?? '(Auto-assign)'} readonly class="readonly-input" />
            </div>
            <div class="field-row">
              <label>Host:</label>
              <input type="text" value={config.host} readonly class="readonly-input" />
            </div>
          </div>
        </div>
      {:else if activeTab === 'config'}
        <div class="config-view">
          <FormBody sections={$spaState.currentFormSchema?.sections || []} />
          <FormActions mode="edit" submitting={false} formId={$formId} />
        </div>
      {:else if activeTab === 'deployments'}
        <DeploymentsList serverId={serverId} />
      {/if}
    </div>
  </div>
{:else}
  <div class="empty-state">Server not found</div>
{/if}

<style>
  .server-detail {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .header {
    padding: var(--jsm-space-xl);
    border-bottom: 1px solid var(--jsm-color-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header-main {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-lg);
  }
  .header-main h1 {
    margin: 0;
    font-size: var(--jsm-font-size-2xl);
    font-weight: var(--jsm-font-weight-medium);
  }
  .header-actions {
    display: flex;
    gap: var(--jsm-space-sm);
  }
  .action-btn {
    background: var(--jsm-color-secondary);
    color: var(--jsm-color-secondary-fg);
    border: 1px solid var(--jsm-color-border-secondary);
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    border-radius: var(--jsm-radius-sm);
    cursor: pointer;
    font-size: var(--jsm-font-size-md);
    font-family: var(--jsm-font-family);
    display: flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    transition: background-color var(--jsm-transition-fast);
  }
  .action-btn:hover {
    background: var(--jsm-color-secondary-hover);
  }
  .action-btn.primary {
    background: var(--jsm-color-primary);
    color: var(--jsm-color-primary-fg);
  }
  .action-btn.primary:hover {
    background: var(--jsm-color-primary-hover);
  }
  .action-btn.danger {
    background: transparent;
    color: var(--jsm-color-error);
    border-color: var(--jsm-color-error);
  }
  .action-btn.danger:hover {
    background: var(--jsm-color-error);
    color: white;
  }
  
  .badge {
    padding: var(--jsm-badge-padding-y) var(--jsm-badge-padding-x);
    border-radius: var(--jsm-badge-radius);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-semibold);
    text-transform: uppercase;
  }
  .badge.running { background: var(--jsm-status-running); color: white; }
  .badge.stopped { background: var(--jsm-status-stopped); color: white; }
  .badge.error { background: var(--jsm-status-error); color: white; }
  .badge.starting, .badge.stopping { background: var(--jsm-status-starting); color: white; }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--jsm-color-border);
    padding: 0 var(--jsm-space-xl);
    background: var(--jsm-color-bg);
  }
  .tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--vscode-tab-inactiveForeground);
    padding: var(--jsm-space-md) var(--jsm-space-lg);
    cursor: pointer;
    font-size: var(--jsm-font-size-md);
    font-family: var(--jsm-font-family);
    display: flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    transition: color var(--jsm-transition-fast), border-color var(--jsm-transition-fast);
  }
  .tab:hover {
    color: var(--vscode-tab-activeForeground);
  }
  .tab.active {
    color: var(--vscode-tab-activeForeground);
    border-bottom-color: var(--vscode-tab-activeBorder);
  }

  .tab-content {
    padding: var(--jsm-space-xl);
    flex: 1;
    overflow-y: auto;
  }

  .config-grid {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-xl);
    max-width: 800px;
  }
  .config-section {
    border: 1px solid var(--jsm-color-border-secondary);
    padding: var(--jsm-space-lg);
    border-radius: var(--jsm-radius-md);
    background: var(--jsm-color-bg-tertiary);
  }
  .config-section h3 {
    margin-top: 0;
    margin-bottom: var(--jsm-space-lg);
    font-size: var(--jsm-font-size-lg);
    border-bottom: 1px solid var(--jsm-color-border);
    padding-bottom: var(--jsm-space-sm);
    font-weight: var(--jsm-font-weight-medium);
  }
  .field-row {
    display: flex;
    margin-bottom: 12px;
    align-items: center;
  }
  .field-row label {
    width: 140px;
    color: var(--vscode-foreground);
    font-weight: 500;
    font-size: 13px;
  }
  .readonly-input {
    flex: 1;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    padding: 6px 8px;
    border-radius: 2px;
    font-family: var(--vscode-editor-font-family);
    font-size: 13px;
  }
  .note {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
  }
  .data-table th, .data-table td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .data-table th {
    font-weight: 600;
    color: var(--vscode-foreground);
    background: var(--vscode-editorWidget-background);
    font-size: 13px;
  }
  .path-cell {
    max-width: 250px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.9em;
  }
  .actions-cell {
    display: flex;
    gap: 4px;
  }
  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    opacity: 0.8;
  }
  .icon-btn:hover {
    background: var(--vscode-list-hoverBackground);
    opacity: 1;
  }
  
  .button-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 14px;
    cursor: pointer;
    border-radius: 2px;
    font-size: 13px;
  }
  .button-primary:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--vscode-descriptionForeground);
    font-size: 14px;
  }
</style>
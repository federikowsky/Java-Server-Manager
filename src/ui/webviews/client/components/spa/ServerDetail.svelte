<script lang="ts">
  import { onDestroy } from 'svelte';
  import { spaState, formId, submitting } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import FormBody from '../FormBody.svelte';
  import FormActions from '../FormActions.svelte';
  import DeploymentsList from './DeploymentsList.svelte';
  import Icon from '../Icon.svelte';

  const { serverId }: { serverId: string } = $props();

  let state = $state($spaState);
  const unsubscribeSpaState = spaState.subscribe(s => { state = s; });

  let serverRecord = $derived(state.servers.find(s => s.config.id === serverId));
  let config = $derived(serverRecord?.config);
  let runtimeState = $derived(serverRecord ? state.runtimeStates[serverRecord.serverKey] : undefined);

  let typeLabel = $derived(
    config ? config.type.charAt(0).toUpperCase() + config.type.slice(1) : '',
  );

  let baseUrl = $derived.by(() => {
    if (!config) return '';
    const pc = config.pluginConfig as { ssl?: { enabled?: boolean; port?: number } } | undefined;
    if (pc?.ssl?.enabled && pc.ssl.port != null) {
      return `https://${config.host}:${pc.ssl.port}`;
    }
    return `http://${config.host}:${config.ports?.http ?? ''}`;
  });
  let isConfigFormReady = $derived(
    activeTab === 'config'
    && !!state.currentFormSchema
    && state.currentFormId === 'jsm.serverForm'
    && state.currentFormTargetId === serverId
  );

  let activeTab = $state('overview');
  let configLoadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let configLoadMessage = $state('');
  let configRequestKey = $state('');
  let configLoadTimer: ReturnType<typeof setTimeout> | undefined;

  function clearConfigTimer(): void {
    if (configLoadTimer) {
      clearTimeout(configLoadTimer);
      configLoadTimer = undefined;
    }
  }

  function requestConfigForm(force = false): void {
    if (!serverRecord) {
      return;
    }

    const nextKey = `${serverId}:${serverRecord.workspaceFolderUri ?? ''}`;
    if (!force && configRequestKey === nextKey && (configLoadState === 'loading' || configLoadState === 'ready' || isConfigFormReady)) {
      return;
    }

    configRequestKey = nextKey;
    configLoadState = 'loading';
    configLoadMessage = '';
    clearConfigTimer();
    configLoadTimer = setTimeout(() => {
      if (activeTab === 'config' && !isConfigFormReady) {
        configLoadState = 'error';
        configLoadMessage = 'The configuration form did not load. Retry the request.';
      }
    }, 1500);

    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.internal.requestServerSchema',
      args: ['edit', serverId, serverRecord.workspaceFolderUri],
    });
  }

  onDestroy(() => {
    unsubscribeSpaState();
    clearConfigTimer();
  });

  $effect(() => {
    const nextKey = serverRecord ? `${serverId}:${serverRecord.workspaceFolderUri ?? ''}` : '';

    if (activeTab !== 'config') {
      clearConfigTimer();
      if (configLoadState !== 'ready') {
        configLoadState = 'idle';
        configLoadMessage = '';
      }
      return;
    }

    if (!serverRecord) {
      return;
    }

    if (configRequestKey !== nextKey) {
      configRequestKey = '';
      configLoadState = 'idle';
      configLoadMessage = '';
      clearConfigTimer();
    }

    if (isConfigFormReady || configLoadState === 'loading' || configLoadState === 'error') {
      return;
    }

    requestConfigForm();
  });

  $effect(() => {
    if (isConfigFormReady) {
      clearConfigTimer();
      configLoadState = 'ready';
      configLoadMessage = '';
    }
  });

  function handleAction(cmd: string) {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: cmd,
      args: [{ 
        serverId, 
        serverKey: serverRecord?.serverKey,
        workspaceFolderUri: serverRecord?.workspaceFolderUri,
        workspaceFolderName: serverRecord?.workspaceFolderName 
      }],
    });
  }
</script>

{#if config}
  <div class="server-detail">
    <header class="context-header">
      <div class="context-header-text">
        <div class="context-title-row">
          <h1 class="context-title">{config.name}</h1>
          <span class="badge {runtimeState?.state || 'stopped'}">
            {runtimeState?.state || 'stopped'}
          </span>
        </div>
        <p class="context-subtitle">{typeLabel} · {baseUrl}</p>
        {#if serverRecord?.workspaceFolderName}
          <p class="context-meta">
            <Icon name="folder" size={12} />
            <span>{serverRecord.workspaceFolderName}</span>
          </p>
        {/if}
      </div>
      <div class="header-actions">
        <button
          type="button"
          class="action-btn"
          title="Open server output log"
          onclick={() => handleAction('jsm.server.showLogs')}
        >
          <Icon name="terminal" size={14} />
          <span>Logs</span>
        </button>
        {#if runtimeState?.state === 'stopped' || runtimeState?.state === 'error'}
          <button class="action-btn primary" onclick={() => handleAction('jsm.server.startRun')}>
            <Icon name="play" size={14} />
            <span>Start</span>
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
    </header>

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
          {#if isConfigFormReady}
            <div class="form-surface">
              <FormBody sections={$spaState.currentFormSchema?.sections || []} />
            </div>
            <FormActions
              mode="edit"
              submitting={$submitting}
              formId={$formId}
              submitLabel="Save Server"
              onCancel={() => activeTab = 'overview'}
            />
          {:else if configLoadState === 'error'}
            <div class="inline-loading-state error">
              <Icon name="error" size={20} />
              <div class="inline-loading-copy">
                <span>{configLoadMessage}</span>
                <button type="button" class="action-btn" onclick={() => requestConfigForm(true)}>
                  <Icon name="refresh" size={14} />
                  <span>Retry</span>
                </button>
              </div>
            </div>
          {:else}
            <div class="inline-loading-state">
              <Icon name="loading" size={20} />
              <span>Loading configuration form…</span>
            </div>
          {/if}
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
  .context-header {
    padding: var(--jsm-space-lg) var(--jsm-space-xl);
    border-bottom: 1px solid var(--jsm-context-header-border);
    background: var(--jsm-context-header-bg);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--jsm-space-xl);
  }
  .context-header-text {
    min-width: 0;
    flex: 1;
  }
  .context-title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--jsm-space-md);
  }
  .context-title {
    margin: 0;
    font-size: var(--jsm-font-size-2xl);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
    line-height: var(--jsm-line-height-tight);
  }
  .context-subtitle {
    margin: var(--jsm-space-xs) 0 0;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
    font-family: var(--jsm-font-family);
    word-break: break-all;
  }
  .context-meta {
    margin: var(--jsm-space-xs) 0 0;
    display: flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-muted);
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
  .action-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
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
    color: var(--vscode-button-foreground);
  }
  
  .badge {
    padding: var(--jsm-badge-padding-y) var(--jsm-badge-padding-x);
    border-radius: var(--jsm-badge-radius);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-semibold);
    text-transform: uppercase;
    border: 1px solid transparent;
  }
  .badge.running {
    background: color-mix(in srgb, var(--jsm-status-running) 20%, transparent);
    color: var(--jsm-status-running);
    border-color: color-mix(in srgb, var(--jsm-status-running) 42%, transparent);
  }
  .badge.stopped {
    background: color-mix(in srgb, var(--jsm-status-stopped) 20%, transparent);
    color: var(--jsm-status-stopped);
    border-color: color-mix(in srgb, var(--jsm-status-stopped) 42%, transparent);
  }
  .badge.error {
    background: color-mix(in srgb, var(--jsm-status-error) 20%, transparent);
    color: var(--jsm-status-error);
    border-color: color-mix(in srgb, var(--jsm-status-error) 42%, transparent);
  }
  .badge.starting,
  .badge.stopping {
    background: color-mix(in srgb, var(--jsm-status-starting) 22%, transparent);
    color: var(--jsm-status-starting);
    border-color: color-mix(in srgb, var(--jsm-status-starting) 45%, transparent);
  }

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
  .tab:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
    border-radius: var(--jsm-radius-xs);
  }

  .tab-content {
    padding: var(--jsm-space-xl);
    flex: 1;
    overflow-y: auto;
  }

  .inline-loading-state {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    color: var(--jsm-color-fg-secondary);
    padding: var(--jsm-space-lg);
    border: 1px dashed var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-md);
    background: var(--jsm-color-bg-secondary);
  }

  .inline-loading-state.error {
    color: var(--jsm-color-error);
    border-style: solid;
    background: color-mix(in srgb, var(--jsm-color-error) 8%, var(--jsm-color-bg-secondary));
  }

  .inline-loading-copy {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-md);
  }

  .form-surface {
    padding: var(--jsm-space-lg);
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-lg);
    background: var(--jsm-color-bg-secondary);
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

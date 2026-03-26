<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { spaState, formData, formId, submitting } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import FormBody from '../FormBody.svelte';
  import FormActions from '../FormActions.svelte';
  import DeploymentsList from './DeploymentsList.svelte';
  import Icon from '../Icon.svelte';
  import SectionBlock from '../ds/SectionBlock.svelte';
  import DetailRows from '../ds/DetailRows.svelte';
  import StatusBadge from '../ds/StatusBadge.svelte';
  import SecondaryTabs from '../ds/SecondaryTabs.svelte';

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

  $effect(() => {
    const tab = state.serverDetailResumeTab;
    if (tab === 'overview' || tab === 'config' || tab === 'deployments') {
      activeTab = tab;
      spaState.update(s => ({ ...s, serverDetailResumeTab: undefined }));
    }
  });

  let configFormBaselineKey = $state('');
  let configFormBaseline = $state<Record<string, unknown> | null>(null);

  $effect(() => {
    if (activeTab !== 'config') {
      configFormBaselineKey = '';
      configFormBaseline = null;
      return;
    }
    if (!isConfigFormReady || !configRequestKey) {
      return;
    }
    if (configFormBaselineKey === configRequestKey) {
      return;
    }
    configFormBaselineKey = configRequestKey;
    configFormBaseline = JSON.parse(JSON.stringify(get(formData))) as Record<string, unknown>;
  });

  function handleConfigFormReset(): void {
    if (configFormBaseline) {
      formData.set(JSON.parse(JSON.stringify(configFormBaseline)) as Record<string, unknown>);
    }
  }

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
          <h1 class="context-title jsm-type-entity-title">{config.name}</h1>
          <StatusBadge state={(runtimeState?.state || 'stopped').toUpperCase()} />
        </div>
        <p class="context-subtitle">
          {typeLabel} · {baseUrl}{#if serverRecord?.workspaceFolderName}
            · {serverRecord.workspaceFolderName}{/if}
        </p>
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
        {#if runtimeState?.state === 'error'}
          <button class="action-btn primary" onclick={() => handleAction('jsm.server.startRun')}>
            <Icon name="play" size={14} />
            <span>Retry Start</span>
          </button>
        {:else if runtimeState?.state === 'stopped'}
          <button class="action-btn primary" onclick={() => handleAction('jsm.server.startRun')}>
            <Icon name="play" size={14} />
            <span>Start</span>
          </button>
        {:else if runtimeState?.state === 'running'}
          <button class="action-btn danger" onclick={() => handleAction('jsm.server.stop')}>
            <Icon name="stop" size={14} />
            <span>Stop</span>
          </button>
        {/if}
      </div>
    </header>

    <div class="entity-tab-shell">
      <SecondaryTabs
        ariaLabel="Server"
        active={activeTab}
        onChange={(id) => (activeTab = id)}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'config', label: 'Configuration' },
          { id: 'deployments', label: 'Deployments' },
        ]}
      />
    </div>

    <!-- Tab Content -->
    <div class="tab-content">
      {#if activeTab === 'overview'}
        <div class="overview-sections jsm-stack-lg">
          <SectionBlock title="Identity">
            <DetailRows
              rows={[
                { label: 'Name', value: String(config.name ?? '') },
                { label: 'Type', value: typeLabel },
                { label: 'Home', value: String(config.runtime?.homePath ?? '—') },
              ]}
            />
          </SectionBlock>
          <SectionBlock title="Ports & Network">
            <DetailRows
              rows={[
                { label: 'HTTP Port', value: String(config.ports?.http ?? '—') },
                {
                  label: 'Debug Port',
                  value: config.ports?.debug != null ? String(config.ports.debug) : '—',
                },
                { label: 'Host', value: String(config.host ?? '—') },
              ]}
            />
          </SectionBlock>
          <SectionBlock title="Runtime">
            <DetailRows
              rows={[
                { label: 'JAVA_HOME', value: String(config.javaHome ?? '—') },
                {
                  label: 'VM Arguments',
                  value: (() => {
                    const args = config.run?.vmArgs;
                    if (!args?.length) return '—';
                    return args.join(' ');
                  })(),
                },
                {
                  label: 'Hooks',
                  value: `${config.hooks?.length ?? 0} configured`,
                },
              ]}
            />
          </SectionBlock>
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
              submitLabel="Save"
              showCancel={false}
              showReset={true}
              onReset={handleConfigFormReset}
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
            <div class="inline-loading-state inline-loading-stack">
              <Icon name="loading" size={20} />
              <div class="inline-loading-lines">
                <span class="loading-title">Loading configuration…</span>
                <span class="loading-desc">Retrieving server details and runtime metadata.</span>
              </div>
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
    flex: 1;
    min-height: 0;
    height: 100%;
  }
  .entity-tab-shell {
    padding: 0 var(--jsm-space-xl);
    background: var(--jsm-surface-0);
    flex-shrink: 0;
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
    font-weight: var(--jsm-font-weight-semibold);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--jsm-color-primary) 35%, transparent);
  }
  .action-btn.primary:hover {
    background: var(--jsm-color-primary-hover);
    filter: brightness(1.05);
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
  
  .tab-content {
    padding: var(--jsm-space-xl);
    flex: 1;
    min-height: 0;
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

  .inline-loading-stack {
    align-items: flex-start;
  }

  .inline-loading-lines {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-2xs);
    min-width: 0;
  }

  .loading-title {
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }

  .loading-desc {
    font-size: var(--jsm-font-size-sm);
    line-height: var(--jsm-line-height-relaxed);
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

  .overview-sections {
    max-width: 52rem;
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

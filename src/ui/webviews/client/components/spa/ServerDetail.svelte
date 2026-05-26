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

  interface Props {
    serverKey?: string;
    serverId?: string;
    workspaceFolderUri?: string;
  }

  type AutosyncDeploymentUi = {
    deploymentId: string;
    deployName: string;
    deploymentType: string;
    syncMode: string;
    state: string;
    active: boolean;
    watchKind?: string;
    watchPath?: string;
    pendingFiles: number;
    pendingBytes: number;
    cooldownRemainingMs: number;
    message?: string;
  };

  type AutosyncServerUi = {
    enabled: boolean;
    suspended: boolean;
    watcherCount: number;
    watcherCap: number;
    deployments: AutosyncDeploymentUi[];
  };

  let { serverKey, serverId, workspaceFolderUri }: Props = $props();

  let state = $state($spaState);
  const unsubscribeSpaState = spaState.subscribe(s => { state = s; });

  let serverRecord = $derived(state.servers.find(s => {
    const cfg = s.config as { id?: string };
    if (serverKey && s.serverKey === serverKey) return true;
    if (workspaceFolderUri && serverId) {
      return s.workspaceFolderUri === workspaceFolderUri && cfg.id === serverId;
    }
    return cfg.id === serverId || s.serverKey === serverId;
  }));
  let config = $derived(serverRecord?.config);
  let configServerId = $derived(config?.id ?? serverId ?? serverKey ?? '');
  let runtimeState = $derived(serverRecord ? state.runtimeStates[serverRecord.serverKey] : undefined);
  let recentOperations = $derived(
    serverRecord ? ((state.operationHistory?.[serverRecord.serverKey] ?? []) as Array<Record<string, unknown>>) : [],
  );
  let autosyncInfo = $derived(
    serverRecord ? ((state.autosyncDiagnostics?.[serverRecord.serverKey]) as AutosyncServerUi | undefined) : undefined,
  );
  let autosyncDeployments = $derived(autosyncInfo?.deployments ?? []);
  let activeAutosyncCount = $derived(autosyncDeployments.filter(item => item.active).length);
  let deploymentHealthMap = $derived(
    serverRecord ? ((state.deploymentHealth?.[serverRecord.serverKey] ?? {}) as Record<string, { ok?: boolean; latencyMs?: number }>) : {},
  );
  let healthCheckDeployments = $derived(
    (config?.deployments ?? []).filter((dep: { healthCheckPath?: string }) =>
      typeof dep.healthCheckPath === 'string' && dep.healthCheckPath.trim().length > 0),
  );
  let healthyDeploymentCount = $derived(
    Object.values(deploymentHealthMap).filter(report => report?.ok === true).length,
  );
  let unhealthyDeploymentCount = $derived(
    Object.values(deploymentHealthMap).filter(report => report?.ok === false).length,
  );

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
    && state.currentFormTargetId === configServerId
    && state.currentFormTargetWorkspaceFolderUri === serverRecord?.workspaceFolderUri
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

    const nextKey = serverRecord.serverKey;
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
      args: ['edit', configServerId, serverRecord.workspaceFolderUri],
    });
  }

  onDestroy(() => {
    unsubscribeSpaState();
    clearConfigTimer();
  });

  $effect(() => {
    const nextKey = serverRecord?.serverKey ?? '';

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
        serverId: configServerId,
        serverKey: serverRecord?.serverKey,
        workspaceFolderUri: serverRecord?.workspaceFolderUri,
        workspaceFolderName: serverRecord?.workspaceFolderName 
      }],
    });
  }

  function handleNoArgAction(cmd: string) {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: cmd,
      args: [],
    });
  }

  function operationLabel(kind: unknown): string {
    const labels: Record<string, string> = {
      LifecycleStart: 'Start',
      LifecycleStop: 'Stop',
      LifecycleRestart: 'Restart',
      DeployFull: 'Redeploy',
      DeploySync: 'Sync',
      DeployRollback: 'Rollback',
      RedeployAll: 'Redeploy All',
      Undeploy: 'Undeploy',
      DeployUndeployed: 'Prepare Deployments',
      RunDeploymentHealthChecks: 'Health Check',
      StatusRefresh: 'Refresh Status',
    };
    return labels[String(kind)] ?? String(kind ?? 'Operation');
  }

  function formatTimestamp(value: unknown): string {
    if (typeof value !== 'number') return '—';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatDuration(value: unknown): string {
    if (typeof value !== 'number') return 'Running';
    if (value < 1000) return `${value} ms`;
    return `${(value / 1000).toFixed(1)} s`;
  }

  function operationTimeline(operation: Record<string, unknown>): Array<Record<string, unknown>> {
    return Array.isArray(operation.timeline)
      ? operation.timeline as Array<Record<string, unknown>>
      : [];
  }

  function timelineStepClass(status: unknown): string {
    return `timeline-step-status ${String(status ?? 'unknown')}`;
  }

  function formatBytes(value: unknown): string {
    if (typeof value !== 'number' || value <= 0) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function autosyncStateLabel(value: unknown): string {
    const labels: Record<string, string> = {
      disabled: 'Disabled',
      manual: 'Manual',
      'not-watchable': 'Not Watchable',
      suspended: 'Suspended',
      watching: 'Watching',
      cooldown: 'Cooldown',
      inactive: 'Inactive',
    };
    return labels[String(value)] ?? String(value ?? 'Unknown');
  }

  function autosyncStateClass(value: unknown): string {
    return `autosync-state ${String(value ?? 'unknown')}`;
  }

  function formatDateTime(value: unknown): string {
    if (typeof value !== 'number') return '—';
    return new Date(value).toLocaleString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
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
          <SectionBlock title="Health & Readiness">
            <div class="health-section">
              <DetailRows
                rows={[
                  { label: 'Runtime State', value: String(runtimeState?.state ?? 'stopped') },
                  { label: 'PID', value: runtimeState?.pid != null ? String(runtimeState.pid) : '—' },
                  { label: 'Last Transition', value: formatDateTime(runtimeState?.lastTransitionAt) },
                  { label: 'Base URL', value: baseUrl || '—' },
                  {
                    label: 'Deployment Health',
                    value: healthCheckDeployments.length === 0
                      ? 'No health checks configured'
                      : `${healthyDeploymentCount} healthy, ${unhealthyDeploymentCount} unhealthy, ${healthCheckDeployments.length} configured`,
                  },
                  {
                    label: 'Last Error',
                    value: runtimeState?.lastError?.message ? String(runtimeState.lastError.message) : '—',
                  },
                ]}
              />
              <button type="button" class="health-refresh-btn" onclick={() => handleNoArgAction('jsm.view.refresh')}>
                <Icon name="refresh" size={14} />
                <span>Refresh</span>
              </button>
            </div>
          </SectionBlock>
          <SectionBlock title="Auto Sync">
            <div class="autosync-section">
              <DetailRows
                rows={[
                  {
                    label: 'Server Auto-Sync',
                    value: autosyncInfo?.enabled ? 'Enabled' : 'Disabled',
                  },
                  {
                    label: 'Watchers',
                    value: autosyncInfo
                      ? `${autosyncInfo.watcherCount} active, ${autosyncInfo.watcherCap} global cap`
                      : 'No watcher data',
                  },
                  {
                    label: 'Deployments',
                    value: `${activeAutosyncCount} watching, ${autosyncDeployments.length} configured`,
                  },
                ]}
              />
              {#if autosyncDeployments.length === 0}
                <div class="empty-section-note">No deployments configured for auto-sync.</div>
              {:else}
                <div class="autosync-list" role="list">
                  {#each autosyncDeployments as item}
                    <div class="autosync-row" role="listitem">
                      <div class="autosync-main">
                        <span class="autosync-name">{item.deployName}</span>
                        <span class={autosyncStateClass(item.state)}>{autosyncStateLabel(item.state)}</span>
                      </div>
                      <div class="autosync-meta">
                        <span>{item.watchPath ?? item.message ?? 'No watch path'}</span>
                        <span>{item.pendingFiles} pending · {formatBytes(item.pendingBytes)}</span>
                      </div>
                      {#if item.cooldownRemainingMs > 0}
                        <div class="autosync-note">Cooldown remaining: {formatDuration(item.cooldownRemainingMs)}</div>
                      {:else if item.message}
                        <div class="autosync-note">{item.message}</div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </SectionBlock>
          <SectionBlock title="Recent Operations">
            {#if recentOperations.length === 0}
              <div class="empty-section-note">No operations recorded in this session.</div>
            {:else}
              <div class="operation-history" role="list">
                {#each recentOperations as operation}
                  <div class="operation-row" role="listitem">
                    <div class="operation-main">
                      <span class="operation-name">{operationLabel(operation.kind)}</span>
                      <span class:failed={operation.status === 'failed'} class:running={operation.status === 'running'} class="operation-status">
                        {String(operation.status ?? 'unknown')}
                      </span>
                    </div>
                    <div class="operation-meta">
                      <span>{formatTimestamp(operation.startedAt)}</span>
                      <span>{formatDuration(operation.durationMs)}</span>
                    </div>
                    {#if operation.errorMessage}
                      <div class="operation-error">{String(operation.errorMessage)}</div>
                    {/if}
                    {#if operationTimeline(operation).length > 0}
                      <div class="operation-timeline" role="list" aria-label="Operation timeline">
                        {#each operationTimeline(operation) as step}
                          <div class="timeline-step" role="listitem">
                            <span class={timelineStepClass(step.status)} aria-hidden="true"></span>
                            <div class="timeline-step-body">
                              <div class="timeline-step-main">
                                <span class="timeline-step-label">{String(step.label ?? step.stepId ?? 'Step')}</span>
                                <span class="timeline-step-state">{String(step.status ?? 'unknown')}</span>
                              </div>
                              <div class="timeline-step-meta">
                                <span>{formatTimestamp(step.startedAt)}</span>
                                <span>{formatDuration(step.durationMs)}</span>
                              </div>
                              {#if step.message}
                                <div class="timeline-step-message">{String(step.message)}</div>
                              {/if}
                              {#if step.errorMessage}
                                <div class="timeline-step-error">{String(step.errorMessage)}</div>
                              {/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </SectionBlock>
        </div>
      {:else if activeTab === 'config'}
        <div class="config-view">
          {#if isConfigFormReady}
            <div class="form-surface">
              <FormBody sections={$spaState.currentFormSchema?.sections || []} layout="spa" />
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
        <DeploymentsList
          serverKey={serverRecord.serverKey}
          serverId={configServerId}
          workspaceFolderUri={serverRecord.workspaceFolderUri}
        />
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
    width: 100%;
    max-width: none;
  }

  .empty-section-note {
    color: var(--jsm-color-fg-muted);
    font-size: var(--jsm-font-size-sm);
  }

  .health-section {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-md);
  }

  .health-refresh-btn {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-sm);
    background: var(--jsm-surface-0);
    color: var(--jsm-color-fg);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-sm);
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    cursor: pointer;
  }

  .health-refresh-btn:hover {
    background: var(--jsm-color-bg-hover);
  }

  .operation-history {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-sm);
  }

  .autosync-section {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-md);
  }

  .autosync-list {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-sm);
  }

  .autosync-row {
    border-bottom: 1px solid var(--jsm-color-border-secondary);
    padding-bottom: var(--jsm-space-sm);
  }

  .autosync-row:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }

  .autosync-main,
  .autosync-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--jsm-space-sm);
  }

  .autosync-name {
    font-weight: var(--jsm-font-weight-semibold);
    min-width: 0;
  }

  .autosync-state {
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-sm);
    white-space: nowrap;
  }

  .autosync-state.watching {
    color: var(--jsm-color-success);
  }

  .autosync-state.cooldown,
  .autosync-state.suspended {
    color: var(--vscode-charts-orange);
  }

  .autosync-state.disabled,
  .autosync-state.manual,
  .autosync-state.inactive,
  .autosync-state.not-watchable {
    color: var(--jsm-color-fg-muted);
  }

  .autosync-meta,
  .autosync-note {
    color: var(--jsm-color-fg-muted);
    font-size: var(--jsm-font-size-sm);
    line-height: var(--jsm-line-height-relaxed);
    margin-top: var(--jsm-space-2xs);
  }

  .autosync-meta span:first-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .operation-row {
    border-bottom: 1px solid var(--jsm-color-border-secondary);
    padding-bottom: var(--jsm-space-sm);
  }

  .operation-row:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }

  .operation-main,
  .operation-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--jsm-space-sm);
  }

  .operation-name {
    font-weight: var(--jsm-font-weight-semibold);
  }

  .operation-status {
    color: var(--jsm-color-success);
    text-transform: capitalize;
    font-size: var(--jsm-font-size-sm);
  }

  .operation-status.failed {
    color: var(--jsm-color-error);
  }

  .operation-status.running {
    color: var(--jsm-color-fg-secondary);
  }

  .operation-meta {
    color: var(--jsm-color-fg-muted);
    font-size: var(--jsm-font-size-sm);
    margin-top: var(--jsm-space-2xs);
  }

  .operation-error {
    color: var(--jsm-color-error);
    font-size: var(--jsm-font-size-sm);
    line-height: var(--jsm-line-height-relaxed);
    margin-top: var(--jsm-space-2xs);
  }

  .operation-timeline {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-xs);
    margin-top: var(--jsm-space-sm);
    padding-left: var(--jsm-space-sm);
    border-left: 1px solid var(--jsm-color-border-secondary);
  }

  .timeline-step {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr);
    gap: var(--jsm-space-sm);
    align-items: start;
  }

  .timeline-step-status {
    width: 8px;
    height: 8px;
    margin-top: 5px;
    border-radius: 50%;
    background: var(--jsm-color-fg-muted);
  }

  .timeline-step-status.succeeded {
    background: var(--jsm-color-success);
  }

  .timeline-step-status.failed {
    background: var(--jsm-color-error);
  }

  .timeline-step-status.running {
    background: var(--vscode-charts-blue);
  }

  .timeline-step-main,
  .timeline-step-meta {
    display: flex;
    justify-content: space-between;
    gap: var(--jsm-space-sm);
  }

  .timeline-step-label {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg);
  }

  .timeline-step-state,
  .timeline-step-meta,
  .timeline-step-message,
  .timeline-step-error {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-muted);
  }

  .timeline-step-state {
    text-transform: capitalize;
    white-space: nowrap;
  }

  .timeline-step-error {
    color: var(--jsm-color-error);
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

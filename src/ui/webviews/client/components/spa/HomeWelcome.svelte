<script lang="ts">
  import { onDestroy } from 'svelte';
  import { spaState, homeRecentServerIds, activeEntity } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import Icon from '../Icon.svelte';
  import { computeHomeOperationalSummary } from '../../lib/homeOperationalSummary';

  const {
    onAddServer,
    onBrowseTemplates,
  }: {
    onAddServer: () => void;
    onBrowseTemplates: () => void;
  } = $props();

  let state = $state($spaState);
  const unsubscribeSpa = spaState.subscribe(s => {
    state = s;
  });

  let recentIds = $state<string[]>([]);
  const unsubscribeRecent = homeRecentServerIds.subscribe(r => {
    recentIds = r;
  });

  onDestroy(() => {
    unsubscribeSpa();
    unsubscribeRecent();
  });

  let summary = $derived(
    computeHomeOperationalSummary(state.servers, state.runtimeStates, state.deploymentStates),
  );

  let trusted = $derived(state.workspaceTrusted !== false);

  let showJavaHint = $derived(
    state.servers.length > 0 && !(state.settings?.defaultJavaHome?.trim?.()),
  );

  let multiRoot = $derived(state.workspaceFolders.length > 1);

  let recentEntries = $derived(
    recentIds
      .map(id => {
        const rec = state.servers.find(s => (s.config as { id?: string }).id === id);
        const cfg = rec?.config as { id?: string; name?: string } | undefined;
        return cfg?.id
          ? {
            id: cfg.id,
            name: typeof cfg.name === 'string' && cfg.name.trim().length > 0 ? cfg.name : cfg.id,
          }
          : null;
      })
      .filter((x): x is { id: string; name: string } => x !== null),
  );

  function openServersView() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.dashboard.focusServersView',
      args: [],
    });
  }

  function openRecent(serverId: string) {
    spaState.update(s => ({ ...s, globalTab: 'home' }));
    activeEntity.set({ type: 'server', id: serverId });
  }
</script>

<div class="home-welcome">
  <div class="home-inner">
    <header class="home-hero">
      <Icon name="server" size={40} class="hero-icon" />
      <h1 class="home-title">Java Server Manager</h1>
      <p class="home-lead">
        Inventory and quick lifecycle live in the <strong>Java Servers</strong> tree. Use this dashboard for detail,
        configuration, templates, and guided flows.
      </p>
    </header>

    {#if !trusted}
      <section class="home-banner trust-banner" aria-live="polite">
        <Icon name="error" size={18} />
        <div>
          <strong>Workspace not trusted.</strong>
          <span>Grant trust to add servers, save settings, and run hooks. You can still browse read-only views.</span>
        </div>
      </section>
    {/if}

    <section class="home-section" aria-labelledby="home-quick-label">
      <h2 id="home-quick-label" class="section-heading">Quick actions</h2>
      <div class="quick-row">
        <button
          type="button"
          class="btn btn-primary"
          disabled={!trusted}
          title={!trusted ? 'Trust the workspace to add servers' : undefined}
          onclick={onAddServer}
        >
          <Icon name="add" size={14} />
          <span>Add server</span>
        </button>
        <button type="button" class="btn btn-secondary" onclick={onBrowseTemplates}>
          <Icon name="file-code" size={14} />
          <span>Browse templates</span>
        </button>
        <button type="button" class="btn btn-secondary" onclick={openServersView}>
          <Icon name="layout" size={14} />
          <span>Open Java Servers view</span>
        </button>
      </div>
    </section>

    <section class="home-section" aria-labelledby="home-summary-label">
      <h2 id="home-summary-label" class="section-heading">Operational summary</h2>
      {#if summary.totalServers === 0}
        <p class="muted">No servers in this workspace yet. Add one from the tree or the button above.</p>
      {:else}
        <div class="stat-grid" role="list">
          <div class="stat-card" role="listitem">
            <span class="stat-value">{summary.totalServers}</span>
            <span class="stat-label">Servers</span>
          </div>
          <div class="stat-card stat-running" role="listitem">
            <span class="stat-value">{summary.running}</span>
            <span class="stat-label">Running</span>
          </div>
          <div class="stat-card" role="listitem">
            <span class="stat-value">{summary.stopped}</span>
            <span class="stat-label">Stopped</span>
          </div>
          <div class="stat-card stat-error" role="listitem">
            <span class="stat-value">{summary.error}</span>
            <span class="stat-label">Server errors</span>
          </div>
          <div class="stat-card" role="listitem">
            <span class="stat-value">{summary.transitioning}</span>
            <span class="stat-label">Busy</span>
          </div>
          <div class="stat-card stat-error" role="listitem">
            <span class="stat-value">{summary.deploymentErrors}</span>
            <span class="stat-label">Deployment errors</span>
          </div>
        </div>
        {#if summary.serversInError.length > 0}
          <div class="error-list-wrap">
            <span class="mini-label">Servers reporting error</span>
            <ul class="error-list">
              {#each summary.serversInError as s}
                <li>
                  <button type="button" class="linkish" onclick={() => openRecent(s.id)}>{s.name}</button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}
    </section>

    <section class="home-section" aria-labelledby="home-recent-label">
      <h2 id="home-recent-label" class="section-heading">Recently opened</h2>
      <p class="muted recent-hint">Session only — not persisted. Open a server from the tree to populate this list.</p>
      {#if recentEntries.length === 0}
        <p class="muted">No recent servers in this session yet.</p>
      {:else}
        <ul class="recent-list">
          {#each recentEntries as r}
            <li>
              <button type="button" class="recent-btn" onclick={() => openRecent(r.id)}>
                <Icon name="server" size={14} />
                <span>{r.name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="home-section hints" aria-labelledby="home-env-label">
      <h2 id="home-env-label" class="section-heading">Environment</h2>
      <ul class="hint-list">
        {#if multiRoot}
          <li>
            <Icon name="info" size={14} />
            <span>Multiple workspace folders are open — servers are scoped per folder.</span>
          </li>
        {/if}
        {#if showJavaHint}
          <li>
            <Icon name="info" size={14} />
            <span
              >Default <strong>JAVA_HOME</strong> is not set in Settings. Set it to speed up provisioning new servers.</span
            >
          </li>
        {/if}
        {#if !multiRoot && !showJavaHint && summary.totalServers > 0}
          <li class="muted">No environment warnings detected for the current configuration.</li>
        {/if}
      </ul>
    </section>
  </div>
</div>

<style>
  .home-welcome {
    height: 100%;
    width: 100%;
    overflow-y: auto;
    padding: var(--jsm-space-xl) var(--jsm-space-xl) var(--jsm-space-3xl);
    background: var(--jsm-color-bg);
    color: var(--jsm-color-fg);
  }

  .home-inner {
    max-width: 640px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-xl);
  }

  .home-hero {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--jsm-space-sm);
  }

  :global(.hero-icon) {
    color: var(--jsm-color-fg-secondary);
  }

  .home-title {
    margin: 0;
    font-size: var(--jsm-font-size-2xl);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }

  .home-lead {
    margin: 0;
    font-size: var(--jsm-font-size-md);
    line-height: var(--jsm-line-height-relaxed);
    color: var(--jsm-color-fg-secondary);
    max-width: 52ch;
  }

  .home-banner {
    display: flex;
    align-items: flex-start;
    gap: var(--jsm-space-md);
    padding: var(--jsm-space-md) var(--jsm-space-lg);
    border-radius: var(--jsm-radius-md);
    border: 1px solid var(--jsm-color-border-secondary);
    font-size: var(--jsm-font-size-sm);
    line-height: var(--jsm-line-height-relaxed);
  }

  .trust-banner {
    background: color-mix(in srgb, var(--jsm-color-warning) 12%, var(--jsm-color-bg-secondary));
    border-color: color-mix(in srgb, var(--jsm-color-warning) 35%, var(--jsm-color-border));
    color: var(--jsm-color-fg);
  }

  .trust-banner strong {
    display: block;
    margin-bottom: var(--jsm-space-2xs);
  }

  .home-section {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-md);
  }

  .section-heading {
    margin: 0;
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vscode-sideBarTitle-foreground, var(--jsm-color-fg-secondary));
  }

  .quick-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--jsm-space-sm);
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
    transition: background-color var(--jsm-transition-fast), opacity var(--jsm-transition-fast);
  }

  .btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--jsm-color-primary);
    color: var(--jsm-color-primary-fg);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--jsm-color-primary-hover);
  }

  .btn-secondary {
    background: var(--jsm-color-secondary);
    color: var(--jsm-color-secondary-fg);
    border: 1px solid var(--jsm-color-border-secondary);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--jsm-color-secondary-hover);
  }

  .muted {
    margin: 0;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
    line-height: var(--jsm-line-height-relaxed);
  }

  .recent-hint {
    margin-top: calc(-1 * var(--jsm-space-sm));
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: var(--jsm-space-sm);
  }

  .stat-card {
    padding: var(--jsm-space-md);
    border-radius: var(--jsm-radius-md);
    border: 1px solid var(--jsm-color-border-secondary);
    background: var(--jsm-color-bg-secondary);
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-2xs);
    align-items: flex-start;
  }

  .stat-value {
    font-size: var(--jsm-font-size-xl);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }

  .stat-label {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .stat-running .stat-value {
    color: var(--jsm-status-running);
  }

  .stat-error .stat-value {
    color: var(--jsm-status-error);
  }

  .mini-label {
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg-secondary);
  }

  .error-list {
    margin: var(--jsm-space-xs) 0 0;
    padding-left: var(--jsm-space-lg);
  }

  .linkish {
    background: none;
    border: none;
    padding: 0;
    color: var(--jsm-color-info);
    cursor: pointer;
    font-size: var(--jsm-font-size-sm);
    text-decoration: underline;
    font-family: var(--jsm-font-family);
  }

  .linkish:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  .recent-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-xs);
  }

  .recent-btn {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    width: 100%;
    text-align: left;
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    border-radius: var(--jsm-radius-sm);
    border: 1px solid var(--jsm-color-border-secondary);
    background: var(--jsm-color-bg-secondary);
    color: var(--jsm-color-fg);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    cursor: pointer;
    transition: background-color var(--jsm-transition-fast);
  }

  .recent-btn:hover {
    background: var(--jsm-color-bg-hover);
  }

  .recent-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }

  .hint-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
    line-height: var(--jsm-line-height-relaxed);
  }

  .hint-list li {
    display: flex;
    align-items: flex-start;
    gap: var(--jsm-space-sm);
  }
</style>

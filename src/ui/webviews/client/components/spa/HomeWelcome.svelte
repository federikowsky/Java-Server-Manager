<script lang="ts">
  import { onDestroy } from 'svelte';
  import { spaState, homeRecentServerIds, activeEntity } from '../../stores';
  import Icon from '../Icon.svelte';
  import RootPageHeader from '../ds/RootPageHeader.svelte';
  import SectionBlock from '../ds/SectionBlock.svelte';
  import DetailRows from '../ds/DetailRows.svelte';

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

  let trusted = $derived(state.workspaceTrusted !== false);

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

  let envRows = $derived([
    {
      label: 'JAVA_HOME',
      value: state.settings?.defaultJavaHome?.trim() ? state.settings.defaultJavaHome : 'Not configured',
    },
    { label: 'Default HTTP port', value: String(state.settings?.defaultHttpPort ?? '—') },
    { label: 'Default debug port', value: String(state.settings?.defaultDebugPort ?? '—') },
    { label: 'Workspace folders', value: String(state.workspaceFolders.length) },
  ]);

  function openRecent(serverId: string) {
    spaState.update(s => ({ ...s, globalTab: 'home' }));
    activeEntity.set({ type: 'server', id: serverId });
  }

  function goSettings() {
    spaState.update(s => ({ ...s, globalTab: 'settings' }));
    activeEntity.set({ type: 'settings' });
  }
</script>

<div class="home-welcome">
  <div class="home-inner jsm-page-padding jsm-stack-lg">
    <RootPageHeader
      title="Java Server Manager"
      subtitle="Manage servers, templates, runtime defaults, and deployments. Use the Java Servers tree for inventory and lifecycle."
    >
      <svelte:fragment slot="actions">
        <button
          type="button"
          class="btn btn-primary"
          disabled={!trusted}
          title={!trusted ? 'Trust the workspace to add servers' : undefined}
          onclick={onAddServer}
        >
          Add Server
        </button>
        <button type="button" class="btn btn-secondary" onclick={onBrowseTemplates}>Browse Templates</button>
      </svelte:fragment>
    </RootPageHeader>

    {#if !trusted}
      <section class="home-banner trust-banner" aria-live="polite">
        <Icon name="error" size={18} />
        <div>
          <strong>Workspace not trusted.</strong>
          <span>Grant trust to add servers, save settings, and run hooks. You can still browse read-only views.</span>
        </div>
      </section>
    {/if}

    <div class="home-two-col">
      <SectionBlock title="Quick actions">
        <ul class="action-list">
          <li>
            <button type="button" class="action-link" disabled={!trusted} onclick={onAddServer}>Add server</button>
          </li>
          <li>
            <button type="button" class="action-link" onclick={onBrowseTemplates}>Browse templates</button>
          </li>
          <li>
            <button type="button" class="action-link" onclick={goSettings}>Configure defaults</button>
          </li>
        </ul>
        {#if multiRoot}
          <p class="muted">Multiple workspace folders are open — servers are scoped per folder.</p>
        {/if}
      </SectionBlock>

      <SectionBlock title="Environment">
        <DetailRows rows={envRows} />
      </SectionBlock>
    </div>

    <SectionBlock title="Recent context">
      {#if recentEntries.length === 0}
        <p class="muted">No recent context yet</p>
        <p class="muted">Open a server from the Java Servers tree to inspect and configure it.</p>
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
    </SectionBlock>
  </div>
</div>

<style>
  .home-welcome {
    height: 100%;
    width: 100%;
    overflow-y: auto;
    background: var(--jsm-surface-0);
    color: var(--jsm-color-fg);
  }

  .home-inner {
    max-width: 960px;
    margin: 0 auto;
  }

  .home-two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--jsm-space-lg);
    align-items: start;
  }

  @media (max-width: 720px) {
    .home-two-col {
      grid-template-columns: 1fr;
    }
  }

  .home-banner {
    display: flex;
    align-items: flex-start;
    gap: var(--jsm-space-md);
    padding: var(--jsm-space-md) var(--jsm-space-lg);
    border-radius: var(--jsm-radius-sm);
    border: 1px solid var(--jsm-color-border-secondary);
    font-size: var(--jsm-font-size-sm);
    line-height: var(--jsm-line-height-relaxed);
  }

  .trust-banner {
    background: color-mix(in srgb, var(--jsm-color-warning) 12%, var(--jsm-surface-1));
    border-color: color-mix(in srgb, var(--jsm-color-warning) 35%, var(--jsm-color-border));
    color: var(--jsm-color-fg);
  }

  .trust-banner strong {
    display: block;
    margin-bottom: var(--jsm-space-2xs);
  }

  .action-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-xs);
  }

  .action-link {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-align: left;
  }

  .action-link:hover:not(:disabled) {
    text-decoration: underline;
  }

  .action-link:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .action-link::before {
    content: '> ';
    color: var(--jsm-color-fg-muted);
  }

  .muted {
    margin: var(--jsm-space-sm) 0 0;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
    line-height: var(--jsm-line-height-relaxed);
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
    background: var(--jsm-surface-0);
    color: var(--jsm-color-fg);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    cursor: pointer;
  }

  .recent-btn:hover {
    background: var(--jsm-color-bg-hover);
  }

  .recent-btn:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    border-radius: var(--jsm-radius-sm);
    font-size: var(--jsm-font-size-sm);
    font-family: var(--jsm-font-family);
    font-weight: var(--jsm-font-weight-semibold);
    cursor: pointer;
    border: none;
  }

  .btn:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
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
</style>

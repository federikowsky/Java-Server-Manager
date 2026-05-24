<script lang="ts">
  import { onDestroy } from 'svelte';
  import { spaState, homeRecentServerIds, activeEntity } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import Icon from '../Icon.svelte';
  import RootPageHeader from '../ds/RootPageHeader.svelte';
  import SectionBlock from '../ds/SectionBlock.svelte';
  import DetailRows from '../ds/DetailRows.svelte';
  import { buildOnboardingSteps, type OnboardingAction } from '../../onboarding';

  const {
    onAddServer,
    onBrowseTemplates,
  }: {
    onAddServer: () => void;
    onBrowseTemplates: () => void;
  } = $props();

  function importInventory(): void {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.server.import',
      args: [],
    });
  }

  let state = $state($spaState);
  const unsubscribeSpa = spaState.subscribe(s => {
    state = s;
  });

  let recentServerKeys = $state<string[]>([]);
  const unsubscribeRecent = homeRecentServerIds.subscribe(r => {
    recentServerKeys = r;
  });

  onDestroy(() => {
    unsubscribeSpa();
    unsubscribeRecent();
  });

  let trusted = $derived(state.workspaceTrusted !== false);

  let multiRoot = $derived(state.workspaceFolders.length > 1);
  let onboardingSteps = $derived(buildOnboardingSteps(state));
  let firstServerEntry = $derived.by(() => {
    for (const record of state.servers) {
      const cfg = record.config as { id?: string; name?: string } | undefined;
      if (cfg?.id) {
        return {
          serverId: cfg.id,
          serverKey: record.serverKey,
          workspaceFolderUri: record.workspaceFolderUri,
          name: typeof cfg.name === 'string' && cfg.name.trim().length > 0 ? cfg.name : cfg.id,
        };
      }
    }
    return undefined;
  });

  let recentEntries = $derived(
    recentServerKeys
      .map(serverKey => {
        const rec = state.servers.find(s => s.serverKey === serverKey);
        const cfg = rec?.config as { id?: string; name?: string } | undefined;
        return cfg?.id
          ? {
              serverKey: rec.serverKey,
              serverId: cfg.id,
              workspaceFolderUri: rec.workspaceFolderUri,
              name: typeof cfg.name === 'string' && cfg.name.trim().length > 0 ? cfg.name : cfg.id,
            }
          : null;
      })
      .filter((x): x is { serverKey: string; serverId: string; workspaceFolderUri: string; name: string } => x !== null),
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

  function openRecent(entry: { serverKey: string; serverId: string; workspaceFolderUri: string }) {
    spaState.update(s => ({ ...s, globalTab: 'home' }));
    activeEntity.set({
      type: 'server',
      id: entry.serverKey,
      serverId: entry.serverId,
      serverKey: entry.serverKey,
      workspaceFolderUri: entry.workspaceFolderUri,
    });
  }

  function goSettings() {
    spaState.update(s => ({ ...s, globalTab: 'settings' }));
    activeEntity.set({ type: 'settings' });
  }

  function addDeployment() {
    if (!firstServerEntry) {
      return;
    }
    spaState.update(s => ({ ...s, globalTab: 'home' }));
    activeEntity.set({
      type: 'deployment',
      serverId: firstServerEntry.serverId,
      serverKey: firstServerEntry.serverKey,
      workspaceFolderUri: firstServerEntry.workspaceFolderUri,
      mode: 'create',
    });
  }

  function handleOnboardingAction(action: OnboardingAction) {
    if (action === 'settings') {
      goSettings();
    } else if (action === 'add-server') {
      onAddServer();
    } else if (action === 'add-deployment') {
      addDeployment();
    }
  }
</script>

<div class="home-welcome">
  <div class="home-inner jsm-page-padding jsm-stack-lg">
    <RootPageHeader
      title="Java Server Manager"
      subtitle="Manage servers, templates, runtime defaults, and deployments."
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

    <SectionBlock title="Setup Checklist">
      <ol class="setup-list">
        {#each onboardingSteps as step}
          <li class:complete={step.status === 'complete'} class:blocked={step.status === 'blocked'}>
            <span class="setup-state">
              {#if step.status === 'complete'}
                <Icon name="check" size={14} />
              {:else if step.status === 'blocked'}
                <Icon name="lock" size={14} />
              {:else}
                <Icon name="circle" size={14} />
              {/if}
            </span>
            <span class="setup-label">{step.label}</span>
            {#if step.action !== 'none' && step.status !== 'complete'}
              <button
                type="button"
                class="setup-action"
                disabled={step.status === 'blocked'}
                onclick={() => handleOnboardingAction(step.action)}
              >
                {#if step.action === 'settings'}Configure{:else if step.action === 'add-server'}Add{:else}Add{/if}
              </button>
            {/if}
          </li>
        {/each}
      </ol>
    </SectionBlock>

    <div class="home-two-col">
      <SectionBlock title="Quick Actions">
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
          <li>
            <button type="button" class="action-link" disabled={!trusted} onclick={importInventory}>
              Import inventory
            </button>
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

    <SectionBlock title="Recent Context">
      {#if recentEntries.length === 0}
        <p class="muted">No recent context yet</p>
        <p class="muted">Open a server from the Java Servers tree to inspect and configure it.</p>
      {:else}
        <ul class="recent-list">
          {#each recentEntries as r}
            <li>
              <button type="button" class="recent-btn" onclick={() => openRecent(r)}>
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
    align-items: stretch;
  }

  /* Same row height: both SectionBlocks fill the taller column */
  .home-two-col > :global(.jsm-section) {
    height: 100%;
    min-height: 0;
  }

  .home-two-col > :global(.jsm-section) > :global(.jsm-section-body) {
    flex: 1;
    min-height: 0;
  }

  .setup-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--jsm-space-sm);
  }

  .setup-list li {
    min-width: 0;
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-sm);
    padding: var(--jsm-space-sm);
    background: var(--jsm-surface-0);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    column-gap: var(--jsm-space-sm);
    row-gap: var(--jsm-space-xs);
    align-items: center;
  }

  .setup-list li.complete {
    border-color: color-mix(in srgb, var(--jsm-color-success) 55%, var(--jsm-color-border-secondary));
  }

  .setup-list li.blocked {
    opacity: 0.72;
  }

  .setup-state {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--jsm-color-fg-secondary);
  }

  .setup-list li.complete .setup-state {
    color: var(--jsm-color-success);
  }

  .setup-label {
    min-width: 0;
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-semibold);
    overflow-wrap: anywhere;
  }

  .setup-action {
    grid-column: 2;
    justify-self: start;
    border: none;
    background: transparent;
    color: var(--vscode-textLink-foreground);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-sm);
    padding: 0;
    cursor: pointer;
  }

  .setup-action:hover:not(:disabled) {
    text-decoration: underline;
  }

  .setup-action:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  @media (max-width: 860px) {
    .setup-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 720px) {
    .home-two-col {
      grid-template-columns: 1fr;
    }
    .setup-list {
      grid-template-columns: 1fr;
    }
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

<script lang="ts">
  import { spaState, activeEntity } from '../../stores';
  import type { ActiveEntity } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import Icon from '../Icon.svelte';

  let state = $state($spaState);
  spaState.subscribe(s => {
    state = s;
  });

  function openDocumentation() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.dashboard.openDocumentation',
      args: [],
    });
  }

  function setTab(tab: 'home' | 'templates' | 'settings') {
    spaState.update(s => ({ ...s, globalTab: tab }));
    if (tab === 'settings') {
      activeEntity.set({ type: 'settings' });
    } else if (tab === 'home') {
      activeEntity.update((e: ActiveEntity) => {
        if (e.type === 'settings' || e.type === 'template' || e.type === 'new-template') {
          return { type: 'welcome' };
        }
        return e;
      });
    }
  }
</script>

<header class="top-bar" role="navigation" aria-label="Dashboard">
  <span class="product-mark" title="Java Server Manager">JSM</span>
  <div class="tabs">
    <button
      type="button"
      class="tab"
      class:active={state.globalTab === 'home'}
      onclick={() => setTab('home')}
    >
      Home
    </button>
    <button
      type="button"
      class="tab"
      class:active={state.globalTab === 'templates'}
      onclick={() => setTab('templates')}
    >
      Templates
    </button>
    <button
      type="button"
      class="tab"
      class:active={state.globalTab === 'settings'}
      onclick={() => setTab('settings')}
    >
      Settings
    </button>
  </div>
  <div class="top-utilities">
    <button
      type="button"
      class="utility-btn"
      title="Documentation"
      aria-label="Open documentation in browser"
      onclick={openDocumentation}
    >
      <Icon name="globe" size={14} />
      <span>Docs</span>
    </button>
  </div>
</header>

<style>
  .top-bar {
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    gap: var(--jsm-space-md);
    border-bottom: 1px solid var(--jsm-topbar-border);
    background: var(--jsm-topbar-bg);
    padding: 0 var(--jsm-space-md);
  }

  .product-mark {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-bold);
    letter-spacing: 0.08em;
    color: var(--jsm-color-fg-secondary);
    padding-right: var(--jsm-space-md);
    border-right: 1px solid var(--jsm-color-border);
  }

  .tabs {
    display: flex;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .tab {
    position: relative;
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--vscode-tab-inactiveForeground);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    cursor: pointer;
    transition:
      color var(--jsm-transition-fast),
      border-color var(--jsm-transition-fast);
  }

  .tab:hover {
    color: var(--vscode-tab-activeForeground);
  }

  .tab.active {
    color: var(--vscode-tab-activeForeground);
    border-bottom-color: var(--vscode-tab-activeBorder, var(--vscode-focusBorder));
  }

  .tab:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
    border-radius: var(--jsm-radius-xs);
  }

  .top-utilities {
    display: flex;
    align-items: center;
    margin-left: auto;
    padding-left: var(--jsm-space-sm);
  }

  .utility-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
    font-family: var(--jsm-font-family);
    color: var(--jsm-color-fg-secondary);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--jsm-radius-sm);
    cursor: pointer;
    transition:
      color var(--jsm-transition-fast),
      background-color var(--jsm-transition-fast);
  }

  .utility-btn:hover {
    color: var(--jsm-color-fg);
    background: var(--jsm-color-bg-hover);
  }

  .utility-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }
</style>

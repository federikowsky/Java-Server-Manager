<script lang="ts">
  import { spaState, activeEntity } from '../../stores';
  import type { ActiveEntity } from '../../stores';

  let state = $state($spaState);
  spaState.subscribe(s => {
    state = s;
  });

  function setTab(tab: 'home' | 'templates' | 'settings') {
    spaState.update(s => ({ ...s, globalTab: tab }));
    if (tab === 'settings') {
      activeEntity.set({ type: 'settings' });
    } else if (tab === 'home') {
      activeEntity.update((e: ActiveEntity) => {
        if (
          e.type === 'settings'
          || e.type === 'template'
          || e.type === 'new-template'
          || e.type === 'edit-template'
          || e.type === 'templates-index'
        ) {
          return { type: 'welcome' };
        }
        return e;
      });
    } else if (tab === 'templates') {
      activeEntity.set({ type: 'templates-index' });
    }
  }
</script>

<header class="top-bar" role="navigation" aria-label="Dashboard">
  <span class="product-mark" title="Java Server Manager">JSM</span>
  <div class="tabs" role="tablist" aria-label="Main">
    <button
      type="button"
      class="tab"
      class:active={state.globalTab === 'home'}
      role="tab"
      aria-selected={state.globalTab === 'home'}
      onclick={() => setTab('home')}
    >
      Home
    </button>
    <button
      type="button"
      class="tab"
      class:active={state.globalTab === 'templates'}
      role="tab"
      aria-selected={state.globalTab === 'templates'}
      onclick={() => setTab('templates')}
    >
      Templates
    </button>
    <button
      type="button"
      class="tab"
      class:active={state.globalTab === 'settings'}
      role="tab"
      aria-selected={state.globalTab === 'settings'}
      onclick={() => setTab('settings')}
    >
      Settings
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
    gap: var(--jsm-space-xs);
    flex: 1;
    min-width: 0;
    align-items: stretch;
    padding: var(--jsm-space-xs) 0;
  }

  .tab {
    position: relative;
    padding: var(--jsm-space-sm) var(--jsm-space-lg);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--vscode-tab-inactiveForeground);
    background: color-mix(in srgb, var(--jsm-color-bg-secondary) 55%, transparent);
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-md);
    margin-bottom: 0;
    cursor: pointer;
    transition:
      color var(--jsm-transition-fast),
      background-color var(--jsm-transition-fast),
      border-color var(--jsm-transition-fast),
      box-shadow var(--jsm-transition-fast);
  }

  .tab:hover {
    color: var(--vscode-tab-activeForeground);
    background: var(--jsm-color-bg-hover);
    border-color: var(--jsm-color-border);
  }

  .tab.active {
    color: var(--vscode-tab-activeForeground);
    background: color-mix(in srgb, var(--jsm-color-primary) 18%, var(--jsm-color-bg));
    border-color: color-mix(in srgb, var(--jsm-color-primary) 45%, var(--jsm-color-border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--jsm-color-primary) 25%, transparent);
  }

  .tab:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
</style>

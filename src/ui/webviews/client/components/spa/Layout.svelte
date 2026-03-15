<script lang="ts">
  import { spaState, hostError } from '../../stores';
  import Sidebar from './Sidebar.svelte';
  import DetailPane from './DetailPane.svelte';
  import GlobalError from '../GlobalError.svelte';
  import Icon from '../Icon.svelte';

  let state = $state($spaState);
  spaState.subscribe(s => { state = s; });

  let error = $state('');
  hostError.subscribe(e => { error = e; });

  let loading = $derived(!state.initialized && !error);
</script>

<div class="spa-layout">
  {#if error}
    <div class="error-banner">
      <GlobalError message={error} />
    </div>
  {/if}
  <div class="main-content">
    <div class="sidebar-container">
      <Sidebar />
    </div>
    <div class="detail-container">
      {#if loading}
        <div class="loading-state">
          <Icon name="loading" size={32} />
          <p>Loading...</p>
        </div>
      {:else}
        <DetailPane />
      {/if}
    </div>
  </div>
</div>

<style>
  .spa-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--jsm-color-bg);
    color: var(--jsm-color-fg);
  }
  .error-banner {
    flex-shrink: 0;
  }
  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  .sidebar-container {
    width: var(--jsm-sidebar-width);
    min-width: 200px;
    border-right: 1px solid var(--jsm-sidebar-border);
    background: var(--jsm-sidebar-bg);
    display: flex;
    flex-direction: column;
  }
  .detail-container {
    flex: 1;
    overflow-y: auto;
    background: var(--jsm-color-bg);
  }
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--jsm-space-md);
    color: var(--jsm-color-fg-secondary);
  }
</style>

<script lang="ts">
  import { spaState, hostError } from '../../stores';
  import TopBar from './TopBar.svelte';
  import DetailPane from './DetailPane.svelte';
  import TemplatesTabPane from './TemplatesTabPane.svelte';
  import SettingsView from './SettingsView.svelte';
  import GlobalError from '../GlobalError.svelte';
  import Icon from '../Icon.svelte';

  let state = $state($spaState);
  spaState.subscribe(s => {
    state = s;
  });

  let error = $state('');
  hostError.subscribe(e => {
    error = e;
  });

  let loading = $derived(!state.initialized && !error);
</script>

<div class="spa-layout">
  {#if error}
    <div class="error-banner">
      <GlobalError message={error} />
    </div>
  {/if}
  <TopBar />
  <div class="main-content">
    {#if loading}
      <div class="loading-state">
        <Icon name="loading" size={32} />
        <p>Loading...</p>
      </div>
    {:else if state.globalTab === 'home'}
      <div class="detail-container">
        <DetailPane />
      </div>
    {:else if state.globalTab === 'templates'}
      <div class="detail-container detail-container--stretch">
        <TemplatesTabPane />
      </div>
    {:else}
      <div class="detail-container detail-container--stretch">
        <SettingsView />
      </div>
    {/if}
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
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .detail-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--jsm-color-bg);
  }
  .detail-container--stretch {
    overflow: hidden;
  }
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: var(--jsm-space-md);
    color: var(--jsm-color-fg-secondary);
  }
</style>

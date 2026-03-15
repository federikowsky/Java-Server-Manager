<script lang="ts">
  import { onDestroy } from 'svelte';
  import { spaState, browseResult, lastCommandResult } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import Icon from '../Icon.svelte';

  let state = $state($spaState);
  const unsubscribeSpaState = spaState.subscribe(s => { state = s; });

  let autoDiscovery = $state(true);
  let scanEnvVars = $state(true);
  let scanCommonPaths = $state(true);
  let defaultHttpPort = $state(8080);
  let defaultDebugPort = $state(5005);
  let defaultJavaHome = $state('');
  let showStatusInSidebar = $state(true);

  let pluginMetaList = $derived(
    Object.entries(state.capabilities)
      .filter(([_, caps]) => (caps as any)?.supportsAutoDetect)
      .map(([type, caps]) => ({
        type,
        displayName: (caps as any)?.displayName || type,
        envVars: (caps as any)?.discoveryEnvVars || [],
        paths: (caps as any)?.discoveryPaths || [],
      }))
  );
  let allEnvVars = $derived(pluginMetaList.flatMap(p => p.envVars).join(', '));
  let allPaths = $derived(pluginMetaList.flatMap(p => p.paths).slice(0, 4).join(', '));

  let settingsFingerprint = $state('');
  let saving = $state(false);
  let saveError = $state('');
  let saveMessage = $state('');
  let pendingRequestId = $state('');

  const unsubscribeBrowse = browseResult.subscribe(result => {
    if (result && result.field === 'defaultJavaHome') {
      defaultJavaHome = result.path;
    }
  });

  const unsubscribeCommandResult = lastCommandResult.subscribe(result => {
    if (!result || !pendingRequestId || result.requestId !== pendingRequestId) {
      return;
    }

    pendingRequestId = '';
    saving = false;

    if (!result.ok) {
      saveError = result.message || 'Unable to save settings.';
      saveMessage = '';
      return;
    }

    saveError = '';
    saveMessage = result.message || 'Settings saved.';
  });

  onDestroy(() => {
    unsubscribeSpaState();
    unsubscribeBrowse();
    unsubscribeCommandResult();
  });

  $effect(() => {
    if (!state.settings) {
      return;
    }

    const nextFingerprint = JSON.stringify(state.settings);
    if (nextFingerprint === settingsFingerprint) {
      return;
    }

    settingsFingerprint = nextFingerprint;
    autoDiscovery = state.settings.autoDiscovery;
    scanEnvVars = state.settings.scanEnvVars;
    scanCommonPaths = state.settings.scanCommonPaths;
    defaultHttpPort = state.settings.defaultHttpPort;
    defaultDebugPort = state.settings.defaultDebugPort;
    defaultJavaHome = state.settings.defaultJavaHome;
    showStatusInSidebar = state.settings.showStatusInSidebar;
  });

  function validatePort(port: number, label: string): string {
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return `${label} must be between 1 and 65535.`;
    }

    return '';
  }

  async function handleSave() {
    const httpError = validatePort(defaultHttpPort, 'Default HTTP port');
    const debugError = validatePort(defaultDebugPort, 'Default debug port');
    if (httpError || debugError) {
      saveError = httpError || debugError;
      saveMessage = '';
      return;
    }

    saving = true;
    saveError = '';
    saveMessage = '';
    pendingRequestId = crypto.randomUUID();
    lastCommandResult.set(null);

    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.settings.save',
      requestId: pendingRequestId,
      args: [{
        autoDiscovery,
        scanEnvVars,
        scanCommonPaths,
        defaultHttpPort,
        defaultDebugPort,
        defaultJavaHome,
        showStatusInSidebar,
      }],
    });
  }

  function handleReset() {
    autoDiscovery = true;
    scanEnvVars = true;
    scanCommonPaths = true;
    defaultHttpPort = 8080;
    defaultDebugPort = 5005;
    defaultJavaHome = '';
    showStatusInSidebar = true;
    saveError = '';
    saveMessage = '';
  }

  function handleBrowseJava() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'browse',
      field: 'defaultJavaHome',
      kind: 'directory',
    });
  }
</script>

<div class="settings-view">
  <div class="header">
    <div class="header-main">
      <Icon name="settings" size={24} />
      <div class="header-text">
        <h1>Global Settings</h1>
        <p class="subtitle">Configure extension-wide preferences</p>
      </div>
    </div>
  </div>

  <div class="settings-content">
    <!-- Autodiscovery Section -->
    <div class="settings-section">
      <h3 class="section-title">
        <Icon name="search" size={16} />
        <span>Autodiscovery</span>
      </h3>

      <div class="setting-row">
        <label class="checkbox-label">
          <input type="checkbox" class="field-checkbox" bind:checked={autoDiscovery} />
          <div class="setting-info">
            <span class="setting-name">Enable automatic server discovery</span>
            <span class="setting-desc">
              Automatically detect {pluginMetaList.map(p => p.displayName).join(', ')} installations on startup
            </span>
          </div>
        </label>
      </div>

      <div class="setting-row" class:disabled={!autoDiscovery}>
        <label class="checkbox-label">
          <input type="checkbox" class="field-checkbox" bind:checked={scanEnvVars} disabled={!autoDiscovery} />
          <div class="setting-info">
            <span class="setting-name">Scan environment variables</span>
            <span class="setting-desc">
              {#if allEnvVars}
                Check {allEnvVars}, and similar variables
              {:else}
                Check server-specific environment variables
              {/if}
            </span>
          </div>
        </label>
      </div>

      <div class="setting-row" class:disabled={!autoDiscovery}>
        <label class="checkbox-label">
          <input type="checkbox" class="field-checkbox" bind:checked={scanCommonPaths} disabled={!autoDiscovery} />
          <div class="setting-info">
            <span class="setting-name">Scan common installation paths</span>
            <span class="setting-desc">
              {#if allPaths}
                Check {allPaths}, etc.
              {:else}
                Check common installation paths for registered server types
              {/if}
            </span>
          </div>
        </label>
      </div>
    </div>

    <!-- Defaults Section -->
    <div class="settings-section">
      <h3 class="section-title">
        <Icon name="settings" size={16} />
        <span>Defaults</span>
      </h3>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Default Java Home</span>
          <span class="setting-desc">Pre-filled JAVA_HOME for new servers</span>
        </div>
        <div class="setting-control path-row">
          <input
            type="text"
            class="field-input"
            bind:value={defaultJavaHome}
            placeholder="Use system default"
          />
          <button type="button" class="btn btn-secondary" onclick={handleBrowseJava} aria-label="Browse default Java home">
            <Icon name="folder" size={14} />
          </button>
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Default HTTP Port</span>
          <span class="setting-desc">Pre-filled HTTP port for new servers</span>
        </div>
        <div class="setting-control">
          <input
            type="number"
            class="field-input port-input"
            bind:value={defaultHttpPort}
            min="1"
            max="65535"
          />
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-name">Default Debug Port</span>
          <span class="setting-desc">Pre-filled debug port for new servers</span>
        </div>
        <div class="setting-control">
          <input
            type="number"
            class="field-input port-input"
            bind:value={defaultDebugPort}
            min="1"
            max="65535"
          />
        </div>
      </div>
    </div>

    <!-- UI Preferences Section -->
    <div class="settings-section">
      <h3 class="section-title">
        <Icon name="layout" size={16} />
        <span>Interface</span>
      </h3>

      <div class="setting-row">
        <label class="checkbox-label">
          <input type="checkbox" class="field-checkbox" bind:checked={showStatusInSidebar} />
          <div class="setting-info">
            <span class="setting-name">Show server status in sidebar</span>
            <span class="setting-desc">Display colored status indicators next to server names</span>
          </div>
        </label>
      </div>
    </div>

    <!-- Workspace Info Section -->
    <div class="settings-section">
      <h3 class="section-title">
        <Icon name="folder" size={16} />
        <span>Workspace</span>
      </h3>

      <div class="workspace-info">
        <div class="info-row">
          <span class="info-label">Workspace Folders:</span>
          <span class="info-value">{state.workspaceFolders.length}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Configured Servers:</span>
          <span class="info-value">{state.servers.length}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Templates:</span>
          <span class="info-value">{state.templates.length}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Plugin Types:</span>
          <span class="info-value">{Object.keys(state.capabilities).join(', ') || 'None'}</span>
        </div>
      </div>
    </div>
  </div>

  {#if saveError}
    <div class="feedback-banner error">
      <Icon name="error" size={16} />
      <span>{saveError}</span>
    </div>
  {:else if saveMessage}
    <div class="feedback-banner success">
      <Icon name="check" size={16} />
      <span>{saveMessage}</span>
    </div>
  {/if}

  <!-- Actions -->
  <div class="settings-actions">
    <button type="button" class="btn btn-secondary" onclick={handleReset}>
      <Icon name="refresh" size={14} />
      <span>Reset to Defaults</span>
    </button>
    <button type="button" class="btn btn-primary" onclick={handleSave} disabled={saving}>
      {#if saving}
        <Icon name="loading" size={14} />
      {:else}
        <Icon name="check" size={14} />
      {/if}
      <span>{saving ? 'Saving...' : 'Save Settings'}</span>
    </button>
  </div>
</div>

<style>
  .settings-view {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .header {
    padding: var(--jsm-space-xl);
    border-bottom: 1px solid var(--jsm-color-border);
  }

  .header-main {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-md);
    color: var(--jsm-color-primary);
  }

  .header-text h1 {
    margin: 0;
    font-size: var(--jsm-font-size-2xl);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg);
  }

  .subtitle {
    margin: var(--jsm-space-2xs) 0 0;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--jsm-space-xl);
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-lg);
  }

  .settings-section {
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-lg);
    padding: var(--jsm-space-lg);
    background: var(--jsm-color-bg-secondary);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    margin: 0 0 var(--jsm-space-lg);
    font-size: var(--jsm-font-size-lg);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
    padding-bottom: var(--jsm-space-sm);
    border-bottom: 1px solid var(--jsm-color-border-secondary);
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--jsm-space-md) 0;
    border-bottom: 1px solid var(--jsm-color-border-secondary);
  }

  .setting-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .setting-row:first-of-type {
    padding-top: 0;
  }

  .setting-row.disabled {
    opacity: 0.5;
  }

  .checkbox-label {
    display: flex;
    align-items: flex-start;
    gap: var(--jsm-space-md);
    cursor: pointer;
    flex: 1;
  }

  .field-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--jsm-color-primary);
    margin-top: 2px;
    flex-shrink: 0;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-2xs);
  }

  .setting-name {
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg);
    font-size: var(--jsm-font-size-md);
  }

  .setting-desc {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
  }

  .setting-control {
    flex-shrink: 0;
  }

  .path-row {
    display: flex;
    gap: var(--jsm-space-sm);
    width: 300px;
  }

  .path-row .field-input {
    flex: 1;
  }

  .field-input {
    padding: var(--jsm-input-padding-y) var(--jsm-input-padding-x);
    background: var(--jsm-input-bg);
    color: var(--jsm-input-fg);
    border: 1px solid var(--jsm-input-border);
    border-radius: var(--jsm-input-radius);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    outline: none;
    transition: border-color var(--jsm-transition-normal), box-shadow var(--jsm-transition-normal);
  }

  .field-input:focus {
    border-color: var(--jsm-color-border-focus);
    box-shadow: var(--jsm-shadow-focus);
  }

  .field-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .port-input {
    width: 100px;
    text-align: center;
  }

  .workspace-info {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-sm);
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    padding: var(--jsm-space-xs) 0;
  }

  .info-label {
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-md);
  }

  .info-value {
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg);
    font-size: var(--jsm-font-size-md);
  }

  .feedback-banner {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-md) var(--jsm-space-xl);
    border-top: 1px solid var(--jsm-color-border);
    font-size: var(--jsm-font-size-sm);
  }

  .feedback-banner.error {
    color: var(--jsm-color-error);
    background: color-mix(in srgb, var(--jsm-color-error) 10%, var(--jsm-color-bg));
  }

  .feedback-banner.success {
    color: var(--jsm-status-running);
    background: color-mix(in srgb, var(--jsm-status-running) 10%, var(--jsm-color-bg));
  }

  .settings-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-lg) var(--jsm-space-xl);
    border-top: 1px solid var(--jsm-color-border);
    background: var(--jsm-color-bg-secondary);
  }
</style>

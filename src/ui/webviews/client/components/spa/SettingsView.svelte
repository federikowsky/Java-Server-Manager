<script lang="ts">
  import { onDestroy } from 'svelte';
  import { spaState, browseResult, lastCommandResult } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import Icon from '../Icon.svelte';
  import RootPageHeader from '../ds/RootPageHeader.svelte';
  import SectionBlock from '../ds/SectionBlock.svelte';
  import DetailRows from '../ds/DetailRows.svelte';

  let state = $state($spaState);
  const unsubscribeSpaState = spaState.subscribe(s => {
    state = s;
  });

  let defaultHttpPort = $state(8080);
  let defaultDebugPort = $state(5005);
  let defaultJavaHome = $state('');

  /** Last values applied from host sync — reset restores these (spec §25.4). */
  let baseline = $state({ http: 8080, debug: 5005, java: '' });

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
    defaultHttpPort = state.settings.defaultHttpPort;
    defaultDebugPort = state.settings.defaultDebugPort;
    defaultJavaHome = state.settings.defaultJavaHome;
    baseline = {
      http: state.settings.defaultHttpPort,
      debug: state.settings.defaultDebugPort,
      java: state.settings.defaultJavaHome,
    };
  });

  let dirty = $derived(
    defaultHttpPort !== baseline.http
    || defaultDebugPort !== baseline.debug
    || defaultJavaHome !== baseline.java,
  );

  let workspaceRows = $derived([
    { label: 'Workspace folders', value: String(state.workspaceFolders.length) },
    { label: 'Configured servers', value: String(state.servers.length) },
    { label: 'Templates', value: String(state.templates.length) },
  ]);

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
      args: [
        {
          defaultHttpPort,
          defaultDebugPort,
          defaultJavaHome,
        },
      ],
    });
  }

  function handleDetectJavaHome() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.java.detect',
    });
  }

  function handleReset() {
    defaultHttpPort = baseline.http;
    defaultDebugPort = baseline.debug;
    defaultJavaHome = baseline.java;
    saveError = '';
    saveMessage = '';
  }

  function handleExportInventory() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.server.export',
      args: [],
    });
  }

  function handleImportInventory() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.server.import',
      args: [],
    });
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
  <div class="settings-scroll jsm-page-padding jsm-stack-lg">
    <RootPageHeader
      title="Settings"
      subtitle="Defaults, environment, inventory backup, and workspace context"
    />

    <SectionBlock title="Defaults">
      <div class="stack-fields">
        <div class="field-block">
          <label class="field-label" for="set-java">Default Java Home</label>
          <div class="path-row">
            <input
              id="set-java"
              type="text"
              class="field-input"
              bind:value={defaultJavaHome}
              placeholder="Use system default"
            />
            <button type="button" class="btn btn-secondary" onclick={handleBrowseJava} aria-label="Browse default Java home">
              <Icon name="folder" size={14} />
            </button>
            <button type="button" class="btn btn-secondary" onclick={handleDetectJavaHome} title="Detect from $JAVA_HOME" aria-label="Detect JAVA_HOME from environment">
              <Icon name="search" size={14} />
            </button>
          </div>
          <p class="field-help">Pre-filled JAVA_HOME for newly created servers</p>
        </div>

        <div class="field-block">
          <label class="field-label" for="set-http">Default HTTP Port</label>
          <input
            id="set-http"
            type="number"
            class="field-input port-input"
            bind:value={defaultHttpPort}
            min="1"
            max="65535"
          />
        </div>

        <div class="field-block">
          <label class="field-label" for="set-dbg">Default Debug Port</label>
          <input
            id="set-dbg"
            type="number"
            class="field-input port-input"
            bind:value={defaultDebugPort}
            min="1"
            max="65535"
          />
        </div>
      </div>
    </SectionBlock>

    <SectionBlock title="Inventory Backup">
      <p class="section-lead">Export or import inventory as JSON</p>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" onclick={handleExportInventory}>
          <Icon name="download" size={16} />
          <span>Export Servers</span>
        </button>
        <button type="button" class="btn btn-secondary" onclick={handleImportInventory}>
          <Icon name="upload" size={16} />
          <span>Import Servers</span>
        </button>
      </div>
    </SectionBlock>

    <SectionBlock title="Workspace">
      <DetailRows rows={workspaceRows} />
    </SectionBlock>
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

  <div class="settings-actions" class:dirty>
    <button type="button" class="btn btn-secondary" onclick={handleReset}>
      <Icon name="refresh" size={14} />
      <span>Reset</span>
    </button>
    <button type="button" class="btn btn-primary" onclick={handleSave} disabled={saving}>
      {#if saving}
        <Icon name="loading" size={14} />
      {:else}
        <Icon name="check" size={14} />
      {/if}
      <span>{saving ? 'Saving…' : 'Save'}</span>
    </button>
  </div>
</div>

<style>
  .settings-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--jsm-surface-0);
  }

  .settings-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    width: 100%;
    box-sizing: border-box;
  }

  .stack-fields {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-lg);
  }

  .field-block {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-xs);
    max-width: 100%;
  }

  .field-label {
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg);
  }

  .field-help {
    margin: 0;
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
    line-height: var(--jsm-line-height-relaxed);
  }

  .path-row {
    display: flex;
    gap: var(--jsm-space-sm);
    align-items: center;
  }

  .path-row .field-input {
    flex: 1;
    min-width: 0;
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
  }

  .field-input:focus {
    border-color: var(--jsm-color-border-focus);
    box-shadow: var(--jsm-shadow-focus);
  }

  .port-input {
    max-width: 8rem;
  }

  .section-lead {
    margin: 0 0 var(--jsm-space-md);
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
    line-height: var(--jsm-line-height-relaxed);
  }

  .btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--jsm-space-sm);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    border-radius: var(--jsm-radius-sm);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-semibold);
    cursor: pointer;
    border: 1px solid transparent;
  }

  .btn-secondary {
    background: var(--jsm-color-secondary);
    color: var(--jsm-color-secondary-fg);
    border-color: var(--jsm-color-border-secondary);
  }

  .btn-secondary:hover {
    background: var(--jsm-color-secondary-hover);
  }

  .btn-primary {
    background: var(--jsm-color-primary);
    color: var(--jsm-color-primary-fg);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--jsm-color-primary-hover);
  }

  .btn-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .feedback-banner {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-md) var(--jsm-space-xl);
    border-top: 1px solid var(--jsm-color-border-secondary);
    font-size: var(--jsm-font-size-sm);
    flex-shrink: 0;
  }

  .feedback-banner.error {
    color: var(--jsm-color-error);
    background: color-mix(in srgb, var(--jsm-color-error) 10%, var(--jsm-surface-0));
  }

  .feedback-banner.success {
    color: var(--jsm-status-running);
    background: color-mix(in srgb, var(--jsm-status-running) 10%, var(--jsm-surface-0));
  }

  .settings-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-lg) var(--jsm-space-xl);
    border-top: 1px solid var(--jsm-color-border-secondary);
    background: var(--jsm-surface-0);
    flex-shrink: 0;
  }

  .settings-actions.dirty {
    box-shadow: 0 -1px 0 color-mix(in srgb, var(--vscode-focusBorder) 35%, transparent);
  }
</style>
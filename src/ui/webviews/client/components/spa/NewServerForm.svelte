<script lang="ts">
  import { spaState, activeEntity, browseResult } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import Icon from '../Icon.svelte';

  let state = $state($spaState);
  spaState.subscribe(s => { state = s; });

  // Available server types from plugin registry
  let availableTypes = $derived(
    Object.keys(state.capabilities).map(type => ({
      type,
      displayName: state.capabilities[type]?.displayName || type,
    }))
  );

  // Form state
  let selectedType = $state(availableTypes[0]?.type || 'tomcat');
  let serverName = $state('');
  let runtimeHome = $state('');
  let javaHome = $state('');
  let httpPort = $state(8080);
  let debugPort = $state<number | undefined>(undefined);
  let host = $state('127.0.0.1');
  let vmArgs = $state<string[]>([]);
  let debugBind = $state('127.0.0.1');

  // Plugin UI metadata (would be populated from host)
  let pluginMeta = $derived(state.capabilities[selectedType] || {});
  let runtimeLabel = $derived(pluginMeta.runtimeHomeLabel || 'Server Home');
  let runtimeHelp = $derived(pluginMeta.runtimeHomeHelp || 'Absolute path to the server installation directory.');
  let defaultName = $derived(pluginMeta.defaultName || `My ${pluginMeta.displayName || 'Server'}`);
  let pluginDisplayName = $derived(pluginMeta.displayName || selectedType);

  // Listen for browse dialog results
  browseResult.subscribe(result => {
    if (result) {
      if (result.field === 'runtime.homePath') {
        runtimeHome = result.path;
      } else if (result.field === 'javaHome') {
        javaHome = result.path;
      }
    }
  });

  // Validation
  let errors = $state<Record<string, string>>({});
  let submitting = $state(false);

  // Workspace selection
  let selectedWorkspace = $state(state.workspaceFolders[0]?.uri || '');

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!serverName.trim()) {
      newErrors.serverName = 'Server name is required';
    }

    if (!runtimeHome.trim()) {
      newErrors.runtimeHome = `${runtimeLabel} is required`;
    }

    if (!javaHome.trim()) {
      newErrors.javaHome = 'JAVA_HOME is required';
    }

    if (!httpPort || httpPort < 1 || httpPort > 65535) {
      newErrors.httpPort = 'HTTP port must be between 1 and 65535';
    }

    if (debugPort !== undefined && (debugPort < 1 || debugPort > 65535)) {
      newErrors.debugPort = 'Debug port must be between 1 and 65535';
    }

    errors = newErrors;
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (!selectedWorkspace) {
      errors = { ...errors, workspace: 'No workspace selected' };
      return;
    }

    submitting = true;

    const config = {
      id: crypto.randomUUID(),
      name: serverName.trim(),
      type: selectedType,
      runtime: {
        homePath: runtimeHome.trim(),
      },
      javaHome: javaHome.trim(),
      host: host.trim(),
      ports: {
        http: httpPort,
        debug: debugPort,
      },
      run: {
        vmArgs: vmArgs.length > 0 ? vmArgs : undefined,
      },
      debug: {
        bind: debugBind,
      },
      deployments: [],
    };

    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.server.add',
      args: [{ config, workspaceFolderUri: selectedWorkspace }],
    });

    // Return to settings view
    activeEntity.set({ type: 'settings' });
  }

  function handleCancel() {
    activeEntity.set({ type: 'settings' });
  }

  function handleBrowseRuntime() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'browse',
      field: 'runtime.homePath',
      kind: 'directory',
    });
  }

  function handleBrowseJava() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'browse',
      field: 'javaHome',
      kind: 'directory',
    });
  }

  function handleAutodiscover() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.server.autodiscover',
    });
  }

  function addVmArg() {
    const arg = prompt('Enter JVM argument (e.g., -Xmx512m)');
    if (arg && arg.trim()) {
      vmArgs = [...vmArgs, arg.trim()];
    }
  }

  function removeVmArg(index: number) {
    vmArgs = vmArgs.filter((_, i) => i !== index);
  }
</script>

<div class="server-form">
  <div class="header">
    <div class="header-main">
      <Icon name="server" size={24} />
      <div class="header-text">
        <h1>Add Server</h1>
        <p class="subtitle">Configure a new {pluginDisplayName} server instance</p>
      </div>
    </div>
  </div>

  <div class="form-content">
    <!-- Server Type Selection -->
    {#if availableTypes.length > 1}
      <div class="form-section">
        <h3 class="section-title">Server Type</h3>
        <div class="form-field">
          <label class="field-label" for="server-type">
            Type <span class="required">*</span>
          </label>
          <select id="server-type" class="field-input" bind:value={selectedType}>
            {#each availableTypes as t}
              <option value={t.type}>{t.displayName}</option>
            {/each}
          </select>
          <p class="field-help">Select the type of server to configure.</p>
        </div>
      </div>
    {/if}

    <!-- Runtime Section -->
    <div class="form-section">
      <h3 class="section-title">Runtime</h3>

      <div class="form-field">
        <label class="field-label" for="runtime-home">
          Server Home ({runtimeLabel}) <span class="required">*</span>
        </label>
        <div class="path-input-row">
          <input
            id="runtime-home"
            type="text"
            class="field-input"
            class:error={errors.runtimeHome}
            bind:value={runtimeHome}
            placeholder="/path/to/{selectedType}"
          />
          <button class="btn btn-secondary" onclick={handleBrowseRuntime}>
            <Icon name="folder" size={14} />
            <span>Browse</span>
          </button>
          <button class="btn btn-secondary" onclick={handleAutodiscover} title="Autodiscover">
            <Icon name="search" size={14} />
          </button>
        </div>
        {#if errors.runtimeHome}
          <p class="field-error visible">{errors.runtimeHome}</p>
        {/if}
        <p class="field-help">{runtimeHelp}</p>
      </div>
    </div>

    <!-- Identity Section -->
    <div class="form-section">
      <h3 class="section-title">Server Identity</h3>

      <div class="form-field">
        <label class="field-label" for="server-name">
          Server Name <span class="required">*</span>
        </label>
        <input
          id="server-name"
          type="text"
          class="field-input"
          class:error={errors.serverName}
          bind:value={serverName}
          placeholder={defaultName}
        />
        {#if errors.serverName}
          <p class="field-error visible">{errors.serverName}</p>
        {/if}
      </div>

      {#if state.workspaceFolders.length > 1}
        <div class="form-field">
          <label class="field-label" for="workspace">
            Workspace <span class="required">*</span>
          </label>
          <select id="workspace" class="field-input" bind:value={selectedWorkspace}>
            {#each state.workspaceFolders as folder}
              <option value={folder.uri}>{folder.name}</option>
            {/each}
          </select>
        </div>
      {/if}
    </div>

    <!-- Java Section -->
    <div class="form-section">
      <h3 class="section-title">Java</h3>

      <div class="form-field">
        <label class="field-label" for="java-home">
          JAVA_HOME <span class="required">*</span>
        </label>
        <div class="path-input-row">
          <input
            id="java-home"
            type="text"
            class="field-input"
            class:error={errors.javaHome}
            bind:value={javaHome}
            placeholder="/path/to/jdk"
          />
          <button class="btn btn-secondary" onclick={handleBrowseJava}>
            <Icon name="folder" size={14} />
            <span>Browse</span>
          </button>
        </div>
        {#if errors.javaHome}
          <p class="field-error visible">{errors.javaHome}</p>
        {/if}
        <p class="field-help">Path to JDK installation. Must contain bin/java.</p>
      </div>
    </div>

    <!-- Ports Section -->
    <div class="form-section">
      <h3 class="section-title">Ports & Network</h3>

      <div class="form-row">
        <div class="form-field">
          <label class="field-label" for="http-port">
            HTTP Port <span class="required">*</span>
          </label>
          <input
            id="http-port"
            type="number"
            class="field-input port-input"
            class:error={errors.httpPort}
            bind:value={httpPort}
            min="1"
            max="65535"
          />
          {#if errors.httpPort}
            <p class="field-error visible">{errors.httpPort}</p>
          {/if}
        </div>

        <div class="form-field">
          <label class="field-label" for="debug-port">
            Debug Port
          </label>
          <input
            id="debug-port"
            type="number"
            class="field-input port-input"
            class:error={errors.debugPort}
            bind:value={debugPort}
            min="1"
            max="65535"
            placeholder="Auto-assign"
          />
          {#if errors.debugPort}
            <p class="field-error visible">{errors.debugPort}</p>
          {/if}
          <p class="field-help">Leave empty to auto-assign a free port.</p>
        </div>
      </div>

      <div class="form-field">
        <label class="field-label" for="host">
          Bind Host
        </label>
        <input
          id="host"
          type="text"
          class="field-input"
          bind:value={host}
          placeholder="127.0.0.1"
        />
      </div>
    </div>

    <!-- Advanced Section -->
    <div class="form-section">
      <h3 class="section-title">Advanced</h3>

      <div class="form-field">
        <label class="field-label">VM Arguments</label>
        <div class="tag-list">
          {#each vmArgs as arg, i}
            <span class="tag">
              {arg}
              <button class="tag-remove" onclick={() => removeVmArg(i)}>
                <Icon name="x" size={10} />
              </button>
            </span>
          {/each}
          {#if vmArgs.length === 0}
            <span class="tag-empty">No VM arguments</span>
          {/if}
        </div>
        <button class="btn btn-secondary btn-sm" onclick={addVmArg}>
          <Icon name="add" size={12} />
          <span>Add Argument</span>
        </button>
        <p class="field-help">JVM arguments (e.g., -Xmx512m, -Dmy.property=value).</p>
      </div>

      <div class="form-field">
        <label class="field-label" for="debug-bind">
          Debug Bind Address
        </label>
        <select id="debug-bind" class="field-input" bind:value={debugBind}>
          <option value="127.0.0.1">127.0.0.1</option>
          <option value="localhost">localhost</option>
          <option value="::1">::1 (IPv6)</option>
        </select>
      </div>
    </div>
  </div>

  <!-- Actions -->
  <div class="form-actions">
    <button class="btn btn-secondary" onclick={handleCancel}>
      <Icon name="x" size={14} />
      <span>Cancel</span>
    </button>
    <button class="btn btn-primary" onclick={handleSubmit} disabled={submitting}>
      {#if submitting}
        <Icon name="loading" size={14} />
      {:else}
        <Icon name="check" size={14} />
      {/if}
      <span>Create Server</span>
    </button>
  </div>
</div>

<style>
  .server-form {
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

  .form-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--jsm-space-xl);
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-lg);
  }

  .form-section {
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-lg);
    padding: var(--jsm-space-lg);
    background: var(--jsm-color-bg-secondary);
  }

  .section-title {
    margin: 0 0 var(--jsm-space-lg);
    font-size: var(--jsm-font-size-lg);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
    padding-bottom: var(--jsm-space-sm);
    border-bottom: 1px solid var(--jsm-color-border-secondary);
  }

  .form-field {
    margin-bottom: var(--jsm-space-lg);
  }

  .form-field:last-child {
    margin-bottom: 0;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--jsm-space-lg);
  }

  .field-label {
    display: block;
    font-weight: var(--jsm-font-weight-semibold);
    font-size: var(--jsm-font-size-md);
    color: var(--jsm-color-fg);
    margin-bottom: var(--jsm-space-xs);
  }

  .required {
    color: var(--jsm-color-error);
  }

  .field-input {
    width: 100%;
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

  .field-input.error {
    border-color: var(--jsm-color-error);
  }

  .port-input {
    max-width: 140px;
  }

  .field-help {
    margin: var(--jsm-space-xs) 0 0;
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
  }

  .field-error {
    margin: var(--jsm-space-xs) 0 0;
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-error);
  }

  .path-input-row {
    display: flex;
    gap: var(--jsm-space-sm);
  }

  .path-input-row .field-input {
    flex: 1;
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--jsm-space-xs);
    margin-bottom: var(--jsm-space-sm);
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    padding: var(--jsm-space-2xs) var(--jsm-space-sm);
    background: var(--jsm-badge-bg);
    color: var(--jsm-badge-fg);
    border-radius: var(--jsm-badge-radius);
    font-size: var(--jsm-font-size-xs);
    font-family: var(--vscode-editor-font-family);
  }

  .tag-remove {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    display: flex;
    opacity: 0.7;
  }

  .tag-remove:hover {
    opacity: 1;
    color: var(--jsm-color-error);
  }

  .tag-empty {
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-muted);
    font-style: italic;
  }

  .btn-sm {
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-lg) var(--jsm-space-xl);
    border-top: 1px solid var(--jsm-color-border);
    background: var(--jsm-color-bg-secondary);
  }
</style>

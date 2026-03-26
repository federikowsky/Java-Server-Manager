<script lang="ts">
  import { onDestroy } from 'svelte';
  import { applyTemplateToServerDraft, createServerDraft } from '@core/authoring';
  import type { PluginConfig } from '@core/types';
  import { spaState, activeEntity, browseResult, lastCommandResult } from '../../../stores';
  import { postToHost } from '../../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../../protocol';
  import Icon from '../../Icon.svelte';
  import AccordionSection from './AccordionSection.svelte';
  import ValidatedInput from './ValidatedInput.svelte';
  import FormPage from '../FormPage.svelte';
  import HookList from '../../HookList.svelte';

  const { templateId }: { templateId?: string } = $props();

  let state = $state($spaState);
  const unsubscribeSpaState = spaState.subscribe(s => { state = s; });

  let availableTypes = $derived(
    Object.keys(state.capabilities).length > 0
      ? Object.keys(state.capabilities).map(type => ({
        type,
        displayName: state.capabilities[type]?.displayName || type,
      }))
      : [{ type: 'tomcat', displayName: 'Tomcat' }]
  );

  let creationMode = $state<'scratch' | 'template'>('scratch');
  let selectedTemplateId = $state('');
  let availableTemplates = $derived(state.templates || []);

  let selectedType = $state('tomcat');
  let serverName = $state('');
  let runtimeHome = $state('');
  let javaHome = $state('');
  let httpPort = $state(8080);
  let debugPort = $state<number | undefined>(undefined);
  let host = $state('127.0.0.1');
  let vmArgs = $state<string[]>([]);
  let vmArgDraft = $state('');
  let debugBind = $state('127.0.0.1');
  let selectedWorkspace = $state('');
  let hooks = $state<any[]>([]);
  let draftPluginConfig = $state<PluginConfig | undefined>(undefined);

  let pluginMeta = $derived(state.capabilities[selectedType] || {});
  let runtimeLabel = $derived(pluginMeta.runtimeHomeLabel || 'Server Home');
  let runtimeHelp = $derived(pluginMeta.runtimeHomeHelp || 'Absolute path to the server installation directory.');
  let defaultName = $derived(pluginMeta.defaultName || `My ${pluginMeta.displayName || 'Server'}`);
  let pluginDisplayName = $derived(pluginMeta.displayName || selectedType);
  let selectedWorkspaceName = $derived(
    state.workspaceFolders.find(folder => folder.uri === selectedWorkspace)?.name || 'No workspace selected'
  );

  let expandedSection = $state<'advanced' | ''>('');
  let errors = $state<Record<string, string>>({});
  let touched = $state<Record<string, boolean>>({});

  type SubmitState = 'idle' | 'submitting';
  let submitState = $state<SubmitState>('idle');
  let submitError = $state('');
  let pendingRequestId = $state('');
  let defaultsHydrated = $state(false);

  function cloneValue<T>(value: T): T {
    if (value === undefined) {
      return value;
    }

    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
  }

  function creationDefaults() {
    return {
      defaultJavaHome: state.settings?.defaultJavaHome ?? '',
      defaultHttpPort: state.settings?.defaultHttpPort ?? 8080,
      defaultDebugPort: state.settings?.defaultDebugPort ?? 5005,
    };
  }

  function applyDraft(draft: {
    name: string;
    type: string;
    runtimeHomePath: string;
    javaHome: string;
    host: string;
    httpPort: number;
    debugPort?: number;
    debugBind: string;
    vmArgs: string[];
    hooks: unknown[];
    pluginConfig?: PluginConfig;
  }): void {
    serverName = draft.name;
    selectedType = draft.type;
    runtimeHome = draft.runtimeHomePath;
    javaHome = draft.javaHome;
    host = draft.host;
    httpPort = draft.httpPort;
    debugPort = draft.debugPort;
    debugBind = draft.debugBind;
    vmArgs = [...draft.vmArgs];
    hooks = cloneValue(draft.hooks);
    draftPluginConfig = cloneValue(draft.pluginConfig);
  }

  function resetToScratchDraft(): void {
    applyDraft(createServerDraft({
      defaults: creationDefaults(),
      fallbackType: selectedType as any,
      overrides: {
        name: serverName.trim(),
      },
    }));
  }

  function buildDraftOverrides() {
    return {
      name: serverName.trim(),
      type: selectedType,
      runtimeHomePath: runtimeHome.trim(),
      javaHome: javaHome.trim(),
      host: host.trim(),
      httpPort,
      debugPort,
      debugBind: debugBind.trim(),
      vmArgs: [...vmArgs],
      hooks: cloneValue(hooks),
      pluginConfig: cloneValue(draftPluginConfig),
    };
  }

  function applyTemplate(nextTemplateId: string): void {
    const tpl = availableTemplates.find((template: any) => template.template?.id === nextTemplateId);
    if (!tpl) {
      resetToScratchDraft();
      return;
    }

    applyDraft(applyTemplateToServerDraft({
      template: tpl.template,
      defaults: creationDefaults(),
      overrides: {
        name: serverName.trim(),
      },
    }));
  }

  const unsubscribeBrowse = browseResult.subscribe(result => {
    if (!result) {
      return;
    }

    if (result.field === 'runtime.homePath') {
      runtimeHome = result.path;
      touched = { ...touched, runtimeHome: true };
    } else if (result.field === 'javaHome') {
      javaHome = result.path;
      touched = { ...touched, javaHome: true };
    }
  });

  const unsubscribeCommandResult = lastCommandResult.subscribe(result => {
    if (!result || !pendingRequestId || result.requestId !== pendingRequestId) {
      return;
    }

    pendingRequestId = '';
    submitState = 'idle';

    if (!result.ok) {
      submitError = result.message || 'Unable to create server.';
      return;
    }

    submitError = '';
    const createdServerId = typeof result.data?.serverId === 'string' ? result.data.serverId : undefined;
    activeEntity.set(createdServerId ? { type: 'server', id: createdServerId } : { type: 'welcome' });
  });

  onDestroy(() => {
    unsubscribeSpaState();
    unsubscribeBrowse();
    unsubscribeCommandResult();
  });

  $effect(() => {
    if (!availableTypes.some(type => type.type === selectedType)) {
      selectedType = availableTypes[0]?.type || 'tomcat';
    }
  });

  $effect(() => {
    if (!state.workspaceFolders.some(folder => folder.uri === selectedWorkspace)) {
      selectedWorkspace = state.workspaceFolders[0]?.uri || '';
    }
  });

  $effect(() => {
    if (!state.initialized || defaultsHydrated) {
      return;
    }

    selectedWorkspace = state.workspaceFolders[0]?.uri || '';
    applyDraft(createServerDraft({
      defaults: creationDefaults(),
      fallbackType: availableTypes[0]?.type || 'tomcat',
      overrides: {
        name: serverName.trim(),
      },
    }));

    if (templateId) {
      const hasTemplate = availableTemplates.some((template: any) => template.template?.id === templateId);
      if (!hasTemplate) {
        return;
      }
      creationMode = 'template';
      selectedTemplateId = templateId;
      applyTemplate(templateId);
    }

    defaultsHydrated = true;
  });



  function validateField(field: string, value: string): string {
    switch (field) {
      case 'serverName':
        return value.trim() ? '' : 'Server name is required';
      case 'selectedTemplateId':
        return creationMode === 'template' && !value ? 'Choose a template' : '';
      case 'runtimeHome':
        return value.trim() ? '' : `${runtimeLabel} is required`;
      case 'javaHome':
        return value.trim() ? '' : 'JAVA_HOME is required';
      case 'httpPort': {
        const port = parseInt(value, 10);
        if (isNaN(port) || port < 1 || port > 65535) return 'Port must be between 1 and 65535';
        return '';
      }
      case 'debugPort': {
        if (!value) return '';
        const port = parseInt(value, 10);
        if (isNaN(port) || port < 1 || port > 65535) return 'Port must be between 1 and 65535';
        if (port === httpPort) return 'Debug port must differ from HTTP port';
        return '';
      }
      default:
        return '';
    }
  }

  function handleFieldInput(field: string, value: string) {
    errors = { ...errors, [field]: validateField(field, value) };
  }

  function handleFieldBlur(field: string) {
    touched = { ...touched, [field]: true };
  }

  function toggleAdvanced() {
    expandedSection = expandedSection === 'advanced' ? '' : 'advanced';
  }

  function setCreationMode(mode: 'scratch' | 'template') {
    creationMode = mode;
    if (mode === 'scratch') {
      selectedTemplateId = '';
      resetToScratchDraft();
      errors = { ...errors, selectedTemplateId: '' };
      return;
    }

    if (templateId && availableTemplates.some((template: any) => template.template?.id === templateId)) {
      selectedTemplateId = templateId;
      applyTemplate(templateId);
    }
  }

  function handleBrowse(field: string) {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'browse',
      field,
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

  function handleDetectJavaHome() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.java.detect',
    });
  }

  function addVmArg() {
    const arg = vmArgDraft.trim();
    if (!arg) {
      return;
    }

    vmArgs = [...vmArgs, arg];
    vmArgDraft = '';
  }

  function handleVmArgKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    addVmArg();
  }

  function removeVmArg(index: number) {
    vmArgs = vmArgs.filter((_, i) => i !== index);
  }

  function handleCancel() {
    if (templateId) {
      activeEntity.set({ type: 'template', id: templateId });
      return;
    }

    activeEntity.set({ type: 'welcome' });
  }

  async function handleSubmit() {
    const allErrors: Record<string, string> = {};
    if (creationMode === 'template' && !selectedTemplateId) allErrors.selectedTemplateId = 'Choose a template';
    if (!serverName.trim()) allErrors.serverName = 'Server name is required';
    if (!runtimeHome.trim()) allErrors.runtimeHome = `${runtimeLabel} is required`;
    if (!javaHome.trim()) allErrors.javaHome = 'JAVA_HOME is required';
    if (!httpPort || httpPort < 1 || httpPort > 65535) allErrors.httpPort = 'Invalid port';
    if (debugPort !== undefined && (debugPort < 1 || debugPort > 65535)) allErrors.debugPort = 'Invalid debug port';
    if (debugPort !== undefined && debugPort === httpPort) allErrors.debugPort = 'Debug port must differ from HTTP port';

    errors = allErrors;
    touched = {
      ...touched,
      serverName: true,
      selectedTemplateId: creationMode === 'template',
      runtimeHome: true,
      javaHome: true,
      httpPort: true,
      debugPort: debugPort !== undefined,
    };

    if (Object.keys(allErrors).length > 0) {
      return;
    }

    if (!selectedWorkspace) {
      submitError = 'Select a workspace before creating the server.';
      return;
    }

    const draft = createServerDraft({
      defaults: creationDefaults(),
      fallbackType: selectedType as any,
      overrides: buildDraftOverrides(),
    });

    submitState = 'submitting';
    submitError = '';
    pendingRequestId = crypto.randomUUID();
    lastCommandResult.set(null);

    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.server.add',
      requestId: pendingRequestId,
      args: [{ draft, workspaceFolderUri: selectedWorkspace }],
    });
  }
</script>

<FormPage
  icon="server"
  eyebrow="New Server"
  title="Add Server"
  subtitle={`Provision a managed ${pluginDisplayName} instance with workspace-aware defaults, runtime paths, and deployment-ready ports.`}
  alignStart={true}
>
  <svelte:fragment slot="actions">
    <span class="meta-chip">{creationMode === 'template' ? 'From Template' : 'From Scratch'}</span>
    <span class="meta-chip subtle">{pluginDisplayName}</span>
  </svelte:fragment>

  <div class="wizard-content">
    <!-- Section 1: Type & Identity (Flat) -->
    <div class="form-section">
      <h3 class="section-title">
        <Icon name="server" size={16} />
        <span>Server Type & Identity</span>
      </h3>
      <div class="section-grid">
        <!-- Creation Mode — Segmented Control -->
        {#if availableTemplates.length > 0}
          <div class="form-field">
            <label class="field-label">How do you want to create this server?</label>
            <div class="segmented-control" role="radiogroup" aria-label="Creation mode">
              <button
                type="button"
                class="segment"
                class:selected={creationMode === 'scratch'}
                role="radio"
                aria-checked={creationMode === 'scratch'}
                onclick={() => setCreationMode('scratch')}
              >
                <Icon name="server" size={14} />
                <span>From Scratch</span>
              </button>
              <button
                type="button"
                class="segment"
                class:selected={creationMode === 'template'}
                role="radio"
                aria-checked={creationMode === 'template'}
                onclick={() => setCreationMode('template')}
              >
                <Icon name="file-code" size={14} />
                <span>From Template</span>
              </button>
            </div>
            <p class="field-help">
              {creationMode === 'scratch' ? 'Configure all settings manually.' : 'Use an existing template as starting point.'}
            </p>
          </div>

          {#if creationMode === 'template'}
            <div class="form-field">
              <label class="field-label" for="template-select">Select Template</label>
              <select 
                id="template-select" 
                class="field-input"
                class:error={errors.selectedTemplateId && touched.selectedTemplateId}
                bind:value={selectedTemplateId}
                onchange={() => {
                  handleFieldInput('selectedTemplateId', selectedTemplateId);
                  applyTemplate(selectedTemplateId);
                }}
                onblur={() => handleFieldBlur('selectedTemplateId')}
              >
                <option value="">Choose a template...</option>
                {#each availableTemplates as tpl}
                  <option value={tpl.template?.id}>{tpl.template?.name} ({tpl.scope})</option>
                {/each}
              </select>
              {#if errors.selectedTemplateId && touched.selectedTemplateId}
                <p class="field-error">{errors.selectedTemplateId}</p>
              {/if}
            </div>
          {/if}
        {/if}

        <!-- Server Type — Segmented Control (only for scratch mode) -->
        {#if creationMode === 'scratch' && availableTypes.length > 1}
          <div class="form-field">
            <label class="field-label">Server Type</label>
            <div class="segmented-control" role="radiogroup" aria-label="Server type">
              {#each availableTypes as t}
                <button
                  type="button"
                  class="segment"
                  class:selected={selectedType === t.type}
                  role="radio"
                  aria-checked={selectedType === t.type}
                  onclick={() => selectedType = t.type}
                >
                  <Icon name="server" size={14} />
                  <span>{t.displayName}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <ValidatedInput
          label="Server Name"
          bind:value={serverName}
          placeholder={defaultName}
          required
          error={touched.serverName ? errors.serverName : ''}
          valid={touched.serverName && serverName.trim().length > 0 && !errors.serverName}
          onInput={(v) => handleFieldInput('serverName', v)}
          onBlur={() => handleFieldBlur('serverName')}
        />

        {#if state.workspaceFolders.length > 1}
          <div class="form-field">
            <label class="field-label" for="workspace">Workspace</label>
            <select id="workspace" class="field-input" bind:value={selectedWorkspace}>
              {#each state.workspaceFolders as folder}
                <option value={folder.uri}>{folder.name}</option>
              {/each}
            </select>
          </div>
        {/if}
      </div>
    </div>

    <!-- Section 2: Runtime & Java (Flat) -->
    <div class="form-section">
      <h3 class="section-title">
        <Icon name="folder" size={16} />
        <span>Runtime & Java</span>
      </h3>
      <div class="section-grid two-columns">
        <div class="form-field">
          <label class="field-label" for="runtime-home">
            {runtimeLabel} <span class="required">*</span>
          </label>
          <div class="path-input-row">
            <input
              id="runtime-home"
              type="text"
              class="field-input"
              class:error={errors.runtimeHome && touched.runtimeHome}
              bind:value={runtimeHome}
              oninput={() => handleFieldInput('runtimeHome', runtimeHome)}
              onblur={() => handleFieldBlur('runtimeHome')}
              placeholder="/path/to/{selectedType}"
            />
            <button type="button" class="btn btn-secondary" onclick={() => handleBrowse('runtime.homePath')} aria-label={`Browse ${runtimeLabel}`}>
              <Icon name="folder" size={14} />
            </button>
            <button type="button" class="btn btn-secondary" onclick={handleAutodiscover} title="Autodiscover" aria-label="Autodiscover server installation">
              <Icon name="search" size={14} />
            </button>
          </div>
          {#if errors.runtimeHome && touched.runtimeHome}
            <p class="field-error">{errors.runtimeHome}</p>
          {:else}
            <p class="field-help">{runtimeHelp}</p>
          {/if}
        </div>

        <div class="form-field">
          <label class="field-label" for="java-home">
            JAVA_HOME <span class="required">*</span>
          </label>
          <div class="path-input-row">
            <input
              id="java-home"
              type="text"
              class="field-input"
              class:error={errors.javaHome && touched.javaHome}
              bind:value={javaHome}
              oninput={() => handleFieldInput('javaHome', javaHome)}
              onblur={() => handleFieldBlur('javaHome')}
              placeholder="/path/to/jdk"
            />
            <button type="button" class="btn btn-secondary" onclick={() => handleBrowse('javaHome')} aria-label="Browse JAVA_HOME">
              <Icon name="folder" size={14} />
            </button>
            <button type="button" class="btn btn-secondary" onclick={handleDetectJavaHome} title="Detect from $JAVA_HOME" aria-label="Detect JAVA_HOME from environment">
              <Icon name="search" size={14} />
            </button>
          </div>
          {#if errors.javaHome && touched.javaHome}
            <p class="field-error">{errors.javaHome}</p>
          {:else}
            <p class="field-help">Path to JDK installation. Must contain bin/java.</p>
          {/if}
        </div>
      </div>
    </div>

    <!-- Section 3: Network & Ports (Flat) -->
    <div class="form-section">
      <h3 class="section-title">
        <Icon name="globe" size={16} />
        <span>Network & Ports</span>
      </h3>
      <div class="section-grid two-columns">
        <div class="form-field">
          <label class="field-label" for="http-port">
            HTTP Port <span class="required">*</span>
          </label>
          <input
            id="http-port"
            type="number"
            class="field-input port-input"
            class:error={errors.httpPort && touched.httpPort}
            bind:value={httpPort}
            oninput={() => handleFieldInput('httpPort', String(httpPort))}
            onblur={() => handleFieldBlur('httpPort')}
            min="1"
            max="65535"
          />
          {#if errors.httpPort && touched.httpPort}
            <p class="field-error">{errors.httpPort}</p>
          {/if}
        </div>

        <div class="form-field">
          <label class="field-label" for="bind-address">Bind Address</label>
          <input
            id="bind-address"
            type="text"
            class="field-input"
            bind:value={host}
            placeholder="127.0.0.1"
          />
          <p class="field-help">IP address or hostname to bind to. Use 0.0.0.0 for all interfaces.</p>
        </div>
      </div>
    </div>

    <!-- Section 4: Advanced (Accordion) -->
    <AccordionSection 
      title="Advanced Options" 
      icon="settings"
      expanded={expandedSection === 'advanced'}
      onToggle={toggleAdvanced}
    >
      <div class="section-grid">
        <div class="section-grid two-columns">
          <div class="form-field">
            <label class="field-label" for="debug-port">Debug Port</label>
            <input
              id="debug-port"
              type="number"
              class="field-input"
              class:error={errors.debugPort && touched.debugPort}
              bind:value={debugPort}
              oninput={() => handleFieldInput('debugPort', debugPort === undefined ? '' : String(debugPort))}
              onblur={() => handleFieldBlur('debugPort')}
              min="1"
              max="65535"
              placeholder="Auto-assign"
            />
            {#if errors.debugPort && touched.debugPort}
              <p class="field-error">{errors.debugPort}</p>
            {:else}
              <p class="field-help">Leave empty to auto-assign.</p>
            {/if}
          </div>

          <div class="form-field">
            <label class="field-label" for="debug-bind">Debug Bind Address</label>
            <select id="debug-bind" class="field-input" bind:value={debugBind}>
              <option value="127.0.0.1">127.0.0.1</option>
              <option value="localhost">localhost</option>
              <option value="::1">::1 (IPv6)</option>
            </select>
            <p class="field-help">Must be a loopback address for security.</p>
          </div>
        </div>

        <div class="form-field">
          <label class="field-label">VM Arguments</label>
          <div class="tag-list">
            {#each vmArgs as arg, i}
              <span class="tag">
                {arg}
                <button type="button" class="tag-remove" onclick={() => removeVmArg(i)} aria-label={`Remove VM argument ${arg}`}>
                  <Icon name="x" size={10} />
                </button>
              </span>
            {/each}
            {#if vmArgs.length === 0}
              <span class="tag-empty">No VM arguments</span>
            {/if}
          </div>
          <div class="vm-presets">
            <span class="presets-label">Presets:</span>
            <button type="button" class="btn btn-secondary btn-xs" onclick={() => { vmArgs = [...vmArgs, '-Xmx512m']; }}>512m</button>
            <button type="button" class="btn btn-secondary btn-xs" onclick={() => { vmArgs = [...vmArgs, '-Xmx1g']; }}>1g</button>
            <button type="button" class="btn btn-secondary btn-xs" onclick={() => { vmArgs = [...vmArgs, '-Xmx2g']; }}>2g</button>
            <button type="button" class="btn btn-secondary btn-xs" onclick={() => { vmArgs = [...vmArgs, '-Xss256k']; }}>-Xss256k</button>
          </div>
          <div class="tag-input-row">
            <input
              type="text"
              class="field-input"
              bind:value={vmArgDraft}
              placeholder="-Xmx1024m"
              onkeydown={handleVmArgKeydown}
            />
            <button type="button" class="btn btn-secondary btn-sm" onclick={addVmArg} disabled={!vmArgDraft.trim()}>
              <Icon name="add" size={12} />
              <span>Add Argument</span>
            </button>
          </div>
          <p class="field-help">JVM arguments (e.g., -Xmx512m, -Dmy.property=value)</p>
        </div>

        <div class="form-field">
          <label class="field-label">Hooks</label>
          <HookList
            def={{ name: 'hooks', label: 'Hooks', type: 'hooks', hookOptions: { taskOptions: state.hookTaskOptions || [] } }}
            value={hooks}
            onChange={(v) => hooks = v}
            id="server-hooks"
          />
          <p class="field-help">Configure hooks as terminal commands or VS Code tasks for lifecycle events.</p>
        </div>
      </div>
    </AccordionSection>
  </div>

  {#if submitError}
    <div class="feedback-banner error">
      <Icon name="error" size={16} />
      <span>{submitError}</span>
    </div>
  {/if}

  <svelte:fragment slot="footer">
    <button type="button" class="btn btn-secondary" onclick={handleCancel} disabled={submitState === 'submitting'}>
      <Icon name="x" size={14} />
      <span>Cancel</span>
    </button>
    <button
      type="button"
      class="btn btn-primary"
      onclick={handleSubmit}
      disabled={submitState === 'submitting'}
    >
      {#if submitState === 'submitting'}
        <Icon name="loading" size={14} />
        <span>Creating...</span>
      {:else}
        <Icon name="check" size={14} />
        <span>Create Server</span>
      {/if}
    </button>
  </svelte:fragment>
</FormPage>

<style>
  .wizard-content {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-lg);
  }

  .meta-chip {
    display: inline-flex;
    align-items: center;
    padding: var(--jsm-space-2xs) var(--jsm-space-sm);
    border-radius: var(--jsm-radius-full, 999px);
    background: color-mix(in srgb, var(--jsm-color-primary) 12%, var(--jsm-color-bg));
    border: 1px solid color-mix(in srgb, var(--jsm-color-primary) 18%, var(--jsm-color-border));
    color: var(--jsm-color-primary);
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .meta-chip.subtle {
    background: var(--jsm-color-bg-secondary);
    border-color: var(--jsm-color-border-secondary);
    color: var(--jsm-color-fg-secondary);
  }

  .section-grid {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-lg);
  }

  .section-grid.two-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--jsm-space-lg);
  }

  .segmented-control {
    display: flex;
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-md);
    overflow: hidden;
  }

  .segment {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--jsm-space-xs);
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    background: var(--jsm-color-bg);
    border: none;
    border-right: 1px solid var(--jsm-color-border-secondary);
    color: var(--jsm-color-fg-secondary);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-medium);
    cursor: pointer;
    transition: all var(--jsm-transition-fast);
  }

  .segment:last-child {
    border-right: none;
  }

  .segment:hover:not(.selected) {
    background: var(--jsm-color-bg-hover);
    color: var(--jsm-color-fg);
  }

  .segment.selected {
    background: var(--jsm-color-primary);
    color: var(--jsm-color-primary-fg);
  }

  .type-name {
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-xs);
  }

  .field-label {
    font-weight: var(--jsm-font-weight-semibold);
    font-size: var(--jsm-font-size-md);
    color: var(--jsm-color-fg);
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
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
    margin: 0;
  }

  .field-error {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-error);
    margin: 0;
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

  .tag-input-row {
    display: flex;
    gap: var(--jsm-space-sm);
    align-items: center;
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
    border: 1px solid color-mix(in srgb, var(--jsm-color-error) 20%, var(--jsm-color-border));
    border-radius: var(--jsm-radius-md);
  }

  .btn-sm {
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
  }

  .btn-xs {
    padding: var(--jsm-space-2xs) var(--jsm-space-xs);
    font-size: var(--jsm-font-size-xs);
  }

  .form-section {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-md);
    padding: var(--jsm-space-lg);
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-lg);
    background: var(--jsm-color-bg);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    font-size: var(--jsm-font-size-md);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
    margin: 0;
  }

  .vm-presets {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    flex-wrap: wrap;
  }

  .presets-label {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
  }

  @media (max-width: 900px) {
    .intro-panel {
      grid-template-columns: 1fr;
    }

    .section-grid.two-columns {
      grid-template-columns: 1fr;
    }

    .type-cards {
      flex-wrap: wrap;
    }
  }
</style>

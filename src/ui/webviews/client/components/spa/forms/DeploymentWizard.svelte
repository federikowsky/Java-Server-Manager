<script lang="ts">
  import { onDestroy } from 'svelte';
  import { formDataToDeploymentDraft } from '@core/authoring';
  import { spaState, activeEntity, browseResult, lastCommandResult } from '../../../stores';
  import { postToHost } from '../../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../../protocol';
  import Icon from '../../Icon.svelte';
  import AccordionSection from './AccordionSection.svelte';
  import FormPage from '../FormPage.svelte';

  interface Props {
    serverId: string;
    deploymentId?: string;
    mode?: 'create' | 'edit';
  }

  let { serverId, deploymentId, mode = 'create' }: Props = $props();

  let state = $state($spaState);
  const unsubscribeSpaState = spaState.subscribe(s => { state = s; });

  let serverRecord = $derived(state.servers.find(s => s.config.id === serverId));
  let config = $derived(serverRecord?.config);
  let existingDeployment = $derived(
    deploymentId ? config?.deployments?.find((d: any) => d.id === deploymentId) : undefined
  );

  let formType = $state<'exploded' | 'war'>('exploded');
  let sourcePath = $state('');
  let deployName = $state('');
  let syncMode = $state<'auto' | 'manual'>('auto');
  let hotReload = $state(false);
  let healthCheckPath = $state('');
  let healthCheckTimeoutMs = $state<number | undefined>(undefined);
  let ignoreGlobs = $state<string[]>([]);
  let ignoreGlobDraft = $state('');

  let expandedSection = $state<'advanced' | ''>('');
  let errors = $state<Record<string, string>>({});
  let touched = $state<Record<string, boolean>>({});

  type SubmitState = 'idle' | 'submitting';
  let submitState = $state<SubmitState>('idle');
  let submitError = $state('');
  let pendingRequestId = $state('');
  let hydratedFor = $state('');

  const unsubscribeBrowse = browseResult.subscribe(result => {
    if (result && result.field === 'sourcePath') {
      sourcePath = result.path;
      touched = { ...touched, sourcePath: true };
    }
  });

  const unsubscribeCommandResult = lastCommandResult.subscribe(result => {
    if (!result || !pendingRequestId || result.requestId !== pendingRequestId) {
      return;
    }

    pendingRequestId = '';
    submitState = 'idle';

    if (!result.ok) {
      submitError = result.message || 'Unable to save deployment.';
      return;
    }

    submitError = '';
    activeEntity.set({ type: 'server', id: serverId });
  });

  onDestroy(() => {
    unsubscribeSpaState();
    unsubscribeBrowse();
    unsubscribeCommandResult();
  });

  $effect(() => {
    if (formType === 'war') {
      hotReload = false;
    }
  });

  $effect(() => {
    const nextKey = `${mode}:${serverId}:${deploymentId ?? 'create'}:${existingDeployment?.id ?? 'pending'}`;
    if (hydratedFor === nextKey) {
      return;
    }

    hydratedFor = nextKey;
    formType = existingDeployment?.type || 'exploded';
    sourcePath = existingDeployment?.sourcePath || '';
    deployName = existingDeployment?.deployName || '';
    syncMode = existingDeployment?.syncMode || 'auto';
    hotReload = existingDeployment?.hotReload || false;
    healthCheckPath = existingDeployment?.healthCheckPath || '';
    healthCheckTimeoutMs = existingDeployment?.healthCheckTimeoutMs;
    ignoreGlobs = existingDeployment?.ignoreGlobs ? [...existingDeployment.ignoreGlobs] : [];
    ignoreGlobDraft = '';
    expandedSection = '';
    errors = {};
    touched = {};
    submitState = 'idle';
    submitError = '';
    pendingRequestId = '';
  });

  function validateField(field: string, value: string): string {
    switch (field) {
      case 'sourcePath':
        return value.trim() ? '' : 'Source path is required';
      case 'deployName':
        if (!value.trim()) return 'Deploy name is required';
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
          return 'Must start with a letter or digit and use only letters, digits, dots, dashes, or underscores';
        }
        return '';
      case 'healthCheckTimeoutMs': {
        if (!value.trim()) return '';
        const timeout = Number(value);
        return Number.isFinite(timeout) && timeout > 0 ? '' : 'Timeout must be a positive number';
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

  function handleBrowse() {
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'browse',
      field: 'sourcePath',
      kind: formType === 'war' ? 'file' : 'directory',
      filters: formType === 'war' ? { 'WAR Files': ['war'] } : undefined,
    });
  }

  function addIgnoreGlob() {
    const glob = ignoreGlobDraft.trim();
    if (!glob) {
      return;
    }

    ignoreGlobs = [...ignoreGlobs, glob];
    ignoreGlobDraft = '';
  }

  function handleIgnoreGlobKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    addIgnoreGlob();
  }

  function removeIgnoreGlob(index: number) {
    ignoreGlobs = ignoreGlobs.filter((_, i) => i !== index);
  }

  function handleCancel() {
    activeEntity.set({ type: 'server', id: serverId });
  }

  async function handleSubmit() {
    const allErrors: Record<string, string> = {};
    if (!sourcePath.trim()) allErrors.sourcePath = 'Source path is required';
    if (!deployName.trim()) allErrors.deployName = 'Deploy name is required';
    else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(deployName)) {
      allErrors.deployName = 'Invalid deploy name format';
    }
    if (
      healthCheckTimeoutMs !== undefined &&
      (!Number.isFinite(healthCheckTimeoutMs) || healthCheckTimeoutMs < 1)
    ) {
      allErrors.healthCheckTimeoutMs = 'Timeout must be a positive number';
    }

    errors = allErrors;
    touched = {
      sourcePath: true,
      deployName: true,
      healthCheckTimeoutMs: healthCheckTimeoutMs !== undefined,
    };

    if (Object.keys(allErrors).length > 0) {
      return;
    }

    if (!serverRecord?.workspaceFolderUri || !serverRecord.serverKey) {
      submitError = 'Server context is missing. Reopen the deployment form from the server detail view.';
      return;
    }

    const formData: Record<string, unknown> = {
      type: formType,
      sourcePath: sourcePath.trim(),
      deployName: deployName.trim(),
      syncMode,
      hotReload: formType === 'exploded' ? hotReload : false,
      healthCheckPath: healthCheckPath.trim() || undefined,
      healthCheckTimeoutMs: healthCheckTimeoutMs && healthCheckTimeoutMs > 0
        ? healthCheckTimeoutMs
        : undefined,
      ignoreGlobs: [...ignoreGlobs],
      hooks: [],
    };
    const draft = formDataToDeploymentDraft(formData, { id: existingDeployment?.id });

    submitState = 'submitting';
    submitError = '';
    pendingRequestId = crypto.randomUUID();
    lastCommandResult.set(null);

    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: mode === 'create' ? 'jsm.deployment.add' : 'jsm.deployment.edit',
      requestId: pendingRequestId,
      args: [{
        serverId,
        serverKey: serverRecord.serverKey,
        workspaceFolderUri: serverRecord.workspaceFolderUri,
        workspaceFolderName: serverRecord.workspaceFolderName,
        deploymentId: draft.id,
        draft,
      }],
    });
  }
</script>

<FormPage
  icon="package"
  eyebrow={mode === 'create' ? 'New Deployment' : 'Edit Deployment'}
  title={mode === 'create' ? 'Add Deployment' : 'Edit Deployment'}
  subtitle={`Deploy content into ${config?.name || 'the selected server'} with the same inline workflow used by the dashboard deployments tab.`}
  alignStart={true}
>
  <svelte:fragment slot="actions">
    <span class="meta-chip">{formType === 'exploded' ? 'Exploded' : 'WAR'}</span>
    <span class="meta-chip subtle">{config?.type || 'Server'}</span>
  </svelte:fragment>

  <div class="wizard-content">
    <!-- Section 1: Source & Type (Flat) -->
    <div class="form-section">
      <h3 class="section-title">
        <Icon name="folder" size={16} />
        <span>Source & Type</span>
      </h3>
      <div class="section-grid">
        <!-- Deployment Type — Segmented Control -->
        <div class="form-field">
          <label class="field-label">Deployment Type</label>
          <div class="segmented-control" role="radiogroup" aria-label="Deployment type">
            <button
              type="button"
              class="segment"
              class:selected={formType === 'exploded'}
              role="radio"
              aria-checked={formType === 'exploded'}
              onclick={() => formType = 'exploded'}
            >
              <Icon name="folder-open" size={14} />
              <span>Exploded Directory</span>
            </button>
            <button
              type="button"
              class="segment"
              class:selected={formType === 'war'}
              role="radio"
              aria-checked={formType === 'war'}
              onclick={() => formType = 'war'}
            >
              <Icon name="package" size={14} />
              <span>WAR File</span>
            </button>
          </div>
          <p class="field-help">
            {formType === 'exploded' ? 'Hot-reload ready for iterative development.' : 'Packaged archive for explicit deploy steps.'}
          </p>
        </div>

        <!-- Source Path -->
        <div class="form-field">
          <label class="field-label" for="source-path">
            Source Path <span class="required">*</span>
          </label>
          <div class="path-input-row">
            <input
              id="source-path"
              type="text"
              class="field-input"
              class:error={errors.sourcePath && touched.sourcePath}
              bind:value={sourcePath}
              oninput={() => handleFieldInput('sourcePath', sourcePath)}
              onblur={() => handleFieldBlur('sourcePath')}
              placeholder={formType === 'war' ? '/path/to/app.war' : '/path/to/exploded/app'}
            />
            <button type="button" class="btn btn-secondary" onclick={handleBrowse} aria-label="Browse deployment source">
              <Icon name="folder" size={14} />
              <span>Browse</span>
            </button>
          </div>
          {#if errors.sourcePath && touched.sourcePath}
            <p class="field-error">{errors.sourcePath}</p>
          {:else}
            <p class="field-help">Path to the {formType === 'war' ? 'WAR file' : 'exploded directory'}.</p>
          {/if}
        </div>

        <!-- Deploy Name -->
        <div class="form-field">
          <label class="field-label" for="deploy-name">
            Context Path <span class="required">*</span>
          </label>
          <input
            id="deploy-name"
            type="text"
            class="field-input"
            class:error={errors.deployName && touched.deployName}
            bind:value={deployName}
            oninput={() => handleFieldInput('deployName', deployName)}
            onblur={() => handleFieldBlur('deployName')}
            placeholder="myapp"
          />
          {#if errors.deployName && touched.deployName}
            <p class="field-error">{errors.deployName}</p>
          {:else}
            <p class="field-help">
              Will be available at http://localhost:{config?.ports?.http || 8080}/{deployName || 'myapp'}
            </p>
          {/if}
        </div>
      </div>
    </div>

    <!-- Section 2: Sync & Options (Flat) -->
    <div class="form-section">
      <h3 class="section-title">
        <Icon name="refresh" size={16} />
        <span>Sync & Options</span>
      </h3>
      <div class="section-grid">
        <div class="form-field">
          <label class="field-label">Synchronization Mode</label>
          <div class="radio-group">
            <label class="radio-option" class:selected={syncMode === 'auto'}>
              <input type="radio" bind:group={syncMode} value="auto" />
              <div class="radio-content">
                <span class="radio-label">Auto</span>
                <span class="radio-desc">
                  {formType === 'war'
                    ? 'When the WAR file changes, it is copied to webapps/ again; Tomcat picks up the update if auto-deploy is enabled.'
                    : 'Files synced automatically on save. The extension applies the lightest safe update and falls back to full redeploy when needed.'}
                </span>
              </div>
            </label>
            <label class="radio-option" class:selected={syncMode === 'manual'}>
              <input type="radio" bind:group={syncMode} value="manual" />
              <div class="radio-content">
                <span class="radio-label">Manual</span>
                <span class="radio-desc">You control when to redeploy from the dashboard or tree.</span>
              </div>
            </label>
          </div>
        </div>

        {#if formType === 'exploded'}
          <div class="form-field">
            <label class="checkbox-label">
              <input type="checkbox" class="field-checkbox" bind:checked={hotReload} />
              <div class="checkbox-content">
                <span class="checkbox-label-text">Enable Hot Reload</span>
                <span class="checkbox-desc">Apply changes without full redeploy. Only affects files outside WEB-INF/ and META-INF/.</span>
              </div>
            </label>
          </div>
        {:else}
          <div class="info-banner">
            <Icon name="info" size={16} />
            <span>WAR deploy copies the packaged file to webapps/. Use Redeploy for a full refresh on demand when sync is manual.</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Section 3: Advanced (Accordion) -->
    <AccordionSection 
      title="Advanced Options" 
      icon="settings"
      expanded={expandedSection === 'advanced'}
      onToggle={toggleAdvanced}
    >
      <div class="section-grid">
        <div class="form-field">
          <label class="field-label" for="health-path">Health Check Path</label>
          <input
            id="health-path"
            type="text"
            class="field-input"
            bind:value={healthCheckPath}
            placeholder="/myapp/health"
          />
          <p class="field-help">Optional GET path for deployment health check. Leave empty to skip.</p>
        </div>

        <div class="form-field">
          <label class="field-label" for="health-timeout">Health Check Timeout (ms)</label>
          <input
            id="health-timeout"
            type="number"
            class="field-input"
            class:error={errors.healthCheckTimeoutMs && touched.healthCheckTimeoutMs}
            bind:value={healthCheckTimeoutMs}
            oninput={() => handleFieldInput('healthCheckTimeoutMs', healthCheckTimeoutMs === undefined ? '' : String(healthCheckTimeoutMs))}
            onblur={() => handleFieldBlur('healthCheckTimeoutMs')}
            min="1"
            placeholder="5000"
          />
          {#if errors.healthCheckTimeoutMs && touched.healthCheckTimeoutMs}
            <p class="field-error">{errors.healthCheckTimeoutMs}</p>
          {:else}
            <p class="field-help">Optional timeout for deployment health checks. Leave empty to use the default.</p>
          {/if}
        </div>

        <div class="form-field">
          <label class="field-label">Ignore Patterns</label>
          <div class="tag-list">
            {#each ignoreGlobs as glob, i}
              <span class="tag">
                {glob}
                <button type="button" class="tag-remove" onclick={() => removeIgnoreGlob(i)} aria-label={`Remove ignore pattern ${glob}`}>
                  <Icon name="x" size={10} />
                </button>
              </span>
            {/each}
            {#if ignoreGlobs.length === 0}
              <span class="tag-empty">No ignore patterns</span>
            {/if}
          </div>
          <div class="tag-input-row">
            <input
              type="text"
              class="field-input"
              bind:value={ignoreGlobDraft}
              placeholder="build/**"
              onkeydown={handleIgnoreGlobKeydown}
            />
            <button type="button" class="btn btn-secondary btn-sm" onclick={addIgnoreGlob} disabled={!ignoreGlobDraft.trim()}>
              <Icon name="add" size={12} />
              <span>Add Pattern</span>
            </button>
          </div>
          <p class="field-help">File patterns to exclude from sync (e.g., "*.tmp", "build/**").</p>
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
        <span>{mode === 'create' ? 'Saving Deployment...' : 'Saving Changes...'}</span>
      {:else}
        <Icon name="check" size={14} />
        <span>{mode === 'create' ? 'Add Deployment' : 'Save Deployment'}</span>
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
    font-size: var(--jsm-font-size-md);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }

  .type-desc {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
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

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-sm);
  }

  .radio-option {
    display: flex;
    align-items: flex-start;
    gap: var(--jsm-space-md);
    padding: var(--jsm-space-md);
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-md);
    cursor: pointer;
    transition: all var(--jsm-transition-normal);
  }

  .radio-option:hover {
    background: var(--jsm-color-bg-hover);
  }

  .radio-option.selected {
    border-color: var(--jsm-color-primary);
    background: color-mix(in srgb, var(--jsm-color-primary) 5%, var(--jsm-color-bg));
  }

  .radio-option input[type="radio"] {
    margin-top: 3px;
    accent-color: var(--jsm-color-primary);
  }

  .radio-content {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-2xs);
  }

  .radio-label {
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg);
  }

  .radio-desc {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
  }

  .checkbox-label {
    display: flex;
    align-items: flex-start;
    gap: var(--jsm-space-md);
    cursor: pointer;
  }

  .field-checkbox {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    accent-color: var(--jsm-color-primary);
  }

  .checkbox-content {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-2xs);
  }

  .checkbox-label-text {
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg);
  }

  .checkbox-desc {
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
  }

  .info-banner {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-md);
    background: color-mix(in srgb, var(--jsm-color-info) 10%, var(--jsm-color-bg));
    border: 1px solid color-mix(in srgb, var(--jsm-color-info) 30%, var(--jsm-color-bg));
    border-radius: var(--jsm-radius-md);
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg);
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

  @media (max-width: 900px) {
    .intro-panel {
      grid-template-columns: 1fr;
    }

    .type-cards {
      flex-wrap: wrap;
    }
  }
</style>

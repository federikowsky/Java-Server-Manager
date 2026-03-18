<script lang="ts">
  import { spaState, activeEntity, browseResult } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import Icon from '../Icon.svelte';

  interface Props {
    serverId: string;
    deploymentId?: string;
    mode: 'create' | 'edit';
  }

  let { serverId, deploymentId, mode }: Props = $props();

  let state = $state($spaState);
  spaState.subscribe(s => { state = s; });

  let serverRecord = $derived(state.servers.find(s => s.config.id === serverId));
  let config = $derived(serverRecord?.config);
  let existingDeployment = $derived(
    deploymentId ? config?.deployments?.find((d: any) => d.id === deploymentId) : undefined
  );

  // Form state
  let formType = $state(existingDeployment?.type || 'exploded');
  let sourcePath = $state(existingDeployment?.sourcePath || '');
  let deployName = $state(existingDeployment?.deployName || '');
  let syncMode = $state(existingDeployment?.syncMode || 'auto');
  let hotReload = $state(existingDeployment?.hotReload || false);
  let healthCheckPath = $state(existingDeployment?.healthCheckPath || '');
  let ignoreGlobs = $state<string[]>(existingDeployment?.ignoreGlobs || []);

  // Listen for browse dialog results
  browseResult.subscribe(result => {
    if (result && result.field === 'sourcePath') {
      sourcePath = result.path;
    }
  });

  // Validation
  let errors = $state<Record<string, string>>({});
  let submitting = $state(false);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!sourcePath.trim()) {
      newErrors.sourcePath = 'Source path is required';
    }

    if (!deployName.trim()) {
      newErrors.deployName = 'Deploy name is required';
    } else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(deployName)) {
      newErrors.deployName = 'Must start with a letter/digit and contain only letters, digits, dots, dashes, underscores';
    }

    errors = newErrors;
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    if (!serverRecord) return;

    submitting = true;

    const deployment = {
      id: existingDeployment?.id || crypto.randomUUID(),
      type: formType,
      sourcePath: sourcePath.trim(),
      deployName: deployName.trim(),
      syncMode: formType === 'exploded' ? syncMode : 'manual',
      hotReload: formType === 'exploded' ? hotReload : false,
      healthCheckPath: healthCheckPath.trim() || undefined,
      ignoreGlobs: ignoreGlobs.length > 0 ? ignoreGlobs : undefined,
    };

    const workspaceFolderUri = serverRecord.workspaceFolderUri;
    const serverKey = workspaceFolderUri ? `${workspaceFolderUri}::${serverId}` : serverId;

    // Send to host for processing
    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: mode === 'create' ? 'jsm.deployment.add' : 'jsm.deployment.edit',
      args: [{
        serverId,
        serverKey,
        workspaceFolderUri,
        workspaceFolderName: serverRecord.workspaceFolderName,
        deploymentId: deployment.id,
        deployment,
      }],
    });

    // Return to server detail view
    activeEntity.set({ type: 'server', id: serverId });
  }

  function handleCancel() {
    activeEntity.set({ type: 'server', id: serverId });
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
    const glob = prompt('Enter ignore pattern (e.g., "*.tmp", "build/**")');
    if (glob && glob.trim()) {
      ignoreGlobs = [...ignoreGlobs, glob.trim()];
    }
  }

  function removeIgnoreGlob(index: number) {
    ignoreGlobs = ignoreGlobs.filter((_, i) => i !== index);
  }
</script>

<div class="deployment-form">
  <div class="header">
    <div class="header-main">
      <Icon name="package" size={24} />
      <div class="header-text">
        <h1>{mode === 'create' ? 'Add Deployment' : 'Edit Deployment'}</h1>
        <p class="subtitle">{config?.name || 'Unknown Server'}</p>
      </div>
    </div>
  </div>

  <div class="form-content">
    <!-- Deployment Type -->
    <div class="form-section">
      <h3 class="section-title">Deployment Configuration</h3>

      <div class="form-field">
        <label class="field-label" for="dep-type">
          Deployment Type <span class="required">*</span>
        </label>
        <select id="dep-type" class="field-input" bind:value={formType}>
          <option value="exploded">Exploded Directory</option>
          <option value="war">WAR File</option>
        </select>
        <p class="field-help">
          {#if formType === 'war'}
            Deploy a packaged WAR file to the server.
          {:else}
            Deploy an exploded (unpacked) directory for hot-reload support.
          {/if}
        </p>
      </div>

      <div class="form-field">
        <label class="field-label" for="dep-source">
          Source Path <span class="required">*</span>
        </label>
        <div class="path-input-row">
          <input
            id="dep-source"
            type="text"
            class="field-input"
            class:error={errors.sourcePath}
            bind:value={sourcePath}
            placeholder={formType === 'war' ? '/path/to/app.war' : '/path/to/exploded/app'}
          />
          <button class="btn btn-secondary" onclick={handleBrowse}>
            <Icon name="folder" size={14} />
            <span>Browse</span>
          </button>
        </div>
        {#if errors.sourcePath}
          <p class="field-error visible">{errors.sourcePath}</p>
        {/if}
        <p class="field-help">Path to the {formType === 'war' ? 'WAR file' : 'exploded directory'}.</p>
      </div>

      <div class="form-field">
        <label class="field-label" for="dep-name">
          Deploy Name <span class="required">*</span>
        </label>
        <input
          id="dep-name"
          type="text"
          class="field-input"
          class:error={errors.deployName}
          bind:value={deployName}
          placeholder="myapp"
        />
        {#if errors.deployName}
          <p class="field-error visible">{errors.deployName}</p>
        {/if}
        <p class="field-help">Context path in webapps/. Must be alphanumeric with dots, dashes, underscores.</p>
      </div>

      {#if formType === 'exploded'}
        <div class="form-field">
          <label class="field-label" for="dep-sync">
            Auto-Sync
          </label>
          <select id="dep-sync" class="field-input" bind:value={syncMode}>
            <option value="auto">Auto</option>
            <option value="manual">Manual</option>
          </select>
          <p class="field-help">Auto applies safe file changes and falls back to redeploy when needed.</p>
        </div>

        <div class="form-field">
          <label class="checkbox-label">
            <input type="checkbox" class="field-checkbox" bind:checked={hotReload} />
            <span>Enable Hot Reload</span>
          </label>
          <p class="field-help">Applies file changes and triggers server context reload without full redeploy. Only affects files outside WEB-INF/ and META-INF/.</p>
        </div>
      {/if}
    </div>

    <!-- Advanced Section -->
    <div class="form-section">
      <h3 class="section-title">Advanced</h3>

      <div class="form-field">
        <label class="field-label" for="dep-health">
          Health Check Path
        </label>
        <input
          id="dep-health"
          type="text"
          class="field-input"
          bind:value={healthCheckPath}
          placeholder="/myapp/health"
        />
        <p class="field-help">Optional GET path for deployment health. Left empty to skip deployment health check.</p>
      </div>

      <div class="form-field">
        <label class="field-label">Ignore Patterns</label>
        <div class="tag-list">
          {#each ignoreGlobs as glob, i}
            <span class="tag">
              {glob}
              <button class="tag-remove" onclick={() => removeIgnoreGlob(i)}>
                <Icon name="x" size={10} />
              </button>
            </span>
          {/each}
          {#if ignoreGlobs.length === 0}
            <span class="tag-empty">No ignore patterns</span>
          {/if}
        </div>
        <button class="btn btn-secondary btn-sm" onclick={addIgnoreGlob}>
          <Icon name="add" size={12} />
          <span>Add Pattern</span>
        </button>
        <p class="field-help">File patterns to exclude from sync.</p>
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
      <span>{mode === 'create' ? 'Create Deployment' : 'Save Changes'}</span>
    </button>
  </div>
</div>

<style>
  .deployment-form {
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

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    cursor: pointer;
    font-weight: var(--jsm-font-weight-medium);
  }

  .field-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--jsm-color-primary);
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

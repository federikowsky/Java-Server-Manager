<script lang="ts">
  import { onDestroy } from 'svelte';
  import { formDataToDeploymentDraft, getDeploymentHookEvents } from '@core/authoring';
  import type { DeploymentBuildConfig, ServerConfig, HookConfig } from '@core/types';
  import {
    spaState,
    activeEntity,
    browseResult,
    lastCommandResult,
    hooksEditorSession,
    deploymentWizardDraft,
    type DeploymentWizardDraftSnapshot,
  } from '../../../stores';
  import { postToHost } from '../../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../../protocol';
  import { HOOK_EVENT_OPTIONS } from '../../../../hookForm';
  import { get } from 'svelte/store';
  import { inferDeploymentContextPath } from './deploymentWizardModel';
  import Icon from '../../Icon.svelte';
  import FormPage from '../FormPage.svelte';
  import SectionBlock from '../../ds/SectionBlock.svelte';
  import AdvancedCollapse from '../../ds/AdvancedCollapse.svelte';
  import ModeSelector from '../../ds/ModeSelector.svelte';
  import ContextTag from '../../ds/ContextTag.svelte';

  interface Props {
    serverId?: string;
    serverKey?: string;
    workspaceFolderUri?: string;
    deploymentId?: string;
    mode?: 'create' | 'edit';
  }

  let { serverId, serverKey, workspaceFolderUri, deploymentId, mode = 'create' }: Props = $props();

  let pageSubtitle = $derived(
    mode === 'create'
      ? 'Choose source path, artifact type, sync behaviour, and optional health check.'
      : 'Update source paths, sync behaviour, and health checks.',
  );

  let state = $state($spaState);
  const unsubscribeSpaState = spaState.subscribe(s => { state = s; });

  let serverRecord = $derived(state.servers.find(s => {
    const cfg = s.config as ServerConfig;
    if (serverKey && s.serverKey === serverKey) return true;
    if (workspaceFolderUri && serverId) {
      return s.workspaceFolderUri === workspaceFolderUri && cfg.id === serverId;
    }
    return cfg.id === serverId || s.serverKey === serverId;
  }));
  let config = $derived(serverRecord ? (serverRecord.config as ServerConfig) : undefined);
  let configServerId = $derived(config?.id ?? serverId ?? serverKey ?? '');
  let existingDeployment = $derived(
    deploymentId ? config?.deployments?.find(d => d.id === deploymentId) : undefined
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
  let buildEnabled = $state(false);
  let buildKind = $state<'command' | 'vscodeTask'>('command');
  let buildTrigger = $state<'manual' | 'manualAndAuto'>('manual');
  let buildTimeoutMs = $state<number | undefined>(60000);
  let buildCommandLine = $state('');
  let buildCommandCwd = $state('');
  let buildEnvDraft = $state('');
  let buildTaskName = $state('');
  let hooks = $state<HookConfig[]>([]);

  let errors = $state<Record<string, string>>({});
  let touched = $state<Record<string, boolean>>({});

  type SubmitState = 'idle' | 'submitting';
  let submitState = $state<SubmitState>('idle');
  let submitError = $state('');
  let pendingRequestId = $state('');
  let hydratedFor = $state('');
  let deployNameUserEdited = $state(false);

  /** Plain deep clone for payloads. Svelte $state arrays are Proxies — structuredClone throws. */
  function cloneValue<T>(value: T): T {
    if (value === undefined) {
      return value;
    }
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(value);
      }
    } catch {
      /* fall through */
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }

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
    deploymentWizardDraft.set(null);
    spaState.update(s => ({ ...s, serverDetailResumeTab: 'deployments' }));
    activeEntity.set({
      type: 'server',
      id: serverRecord?.serverKey ?? serverKey ?? configServerId,
      serverId: configServerId,
      serverKey: serverRecord?.serverKey ?? serverKey,
      workspaceFolderUri: serverRecord?.workspaceFolderUri ?? workspaceFolderUri,
    });
  });

  let lastInferredName = '';

  $effect(() => {
    const inference = inferDeploymentContextPath({
      sourcePath,
      deployName,
      lastInferredName,
      deployNameUserEdited,
    });

    if (!inference.changed) {
      return;
    }

    deployName = inference.deployName;
    lastInferredName = inference.lastInferredName;
    if (errors.deployName && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(inference.deployName)) {
      errors.deployName = '';
    }
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
    const savedDraft = get(deploymentWizardDraft);
    const currentDraftKey = getDraftKey();
    if (savedDraft?.key === currentDraftKey && hydratedFor !== `draft:${currentDraftKey}`) {
      hydratedFor = `draft:${currentDraftKey}`;
      restoreDeploymentWizardDraft(savedDraft);
      return;
    }

    const nextKey = `${mode}:${serverRecord?.serverKey ?? serverKey ?? configServerId}:${deploymentId ?? 'create'}:${existingDeployment?.id ?? 'pending'}`;
    if (hydratedFor === nextKey) {
      return;
    }

    hydratedFor = nextKey;
    formType = existingDeployment?.type || 'exploded';
    sourcePath = existingDeployment?.sourcePath || '';
    deployName = existingDeployment?.deployName || '';
    lastInferredName = existingDeployment?.deployName || '';
    deployNameUserEdited = Boolean(existingDeployment?.deployName);
    syncMode = existingDeployment?.syncMode || 'auto';
    hotReload = existingDeployment?.hotReload || false;
    healthCheckPath = existingDeployment?.healthCheckPath || '';
    healthCheckTimeoutMs = existingDeployment?.healthCheckTimeoutMs;
    ignoreGlobs = existingDeployment?.ignoreGlobs ? [...existingDeployment.ignoreGlobs] : [];
    ignoreGlobDraft = '';
    applyBuildConfig(existingDeployment?.build);
    hooks = existingDeployment?.hooks ? cloneValue(existingDeployment.hooks) : [];
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

  function handleDeployNameInput() {
    deployNameUserEdited = true;
    handleFieldInput('deployName', deployName);
  }

  function handleFieldBlur(field: string) {
    touched = { ...touched, [field]: true };
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

  function buildEnvToDraft(env: Record<string, string> | undefined): string {
    if (!env) return '';
    return Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  }

  function parseBuildEnvDraft(value: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const rawLine of value.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const entryValue = line.slice(separator + 1);
      if (key) {
        env[key] = entryValue;
      }
    }
    return env;
  }

  function applyBuildConfig(build: DeploymentBuildConfig | undefined): void {
    buildEnabled = build?.enabled === true;
    buildKind = build?.kind ?? 'command';
    buildTrigger = build?.trigger ?? 'manual';
    buildTimeoutMs = build?.timeoutMs ?? 60000;
    buildCommandLine = build?.command?.line ?? '';
    buildCommandCwd = build?.command?.cwd ?? '';
    buildEnvDraft = buildEnvToDraft(build?.command?.env);
    buildTaskName = build?.vscodeTask?.taskName ?? '';
  }

  function buildConfigFromFields(enabled: boolean): DeploymentBuildConfig {
    if (buildKind === 'vscodeTask') {
      return {
        enabled,
        kind: 'vscodeTask',
        trigger: buildTrigger,
        timeoutMs: buildTimeoutMs ?? 60000,
        vscodeTask: {
          taskName: buildTaskName.trim(),
        },
      };
    }

    const env = parseBuildEnvDraft(buildEnvDraft);
    return {
      enabled,
      kind: 'command',
      trigger: buildTrigger,
      timeoutMs: buildTimeoutMs ?? 60000,
      command: {
        mode: 'shell',
        line: buildCommandLine.trim(),
        ...(buildCommandCwd.trim() ? { cwd: buildCommandCwd.trim() } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      },
    };
  }

  function currentBuildConfig(): DeploymentBuildConfig | undefined {
    return buildEnabled ? buildConfigFromFields(true) : undefined;
  }

  function snapshotBuildConfig(): DeploymentBuildConfig {
    return buildConfigFromFields(buildEnabled);
  }

  function getDraftKey(): string {
    return `${mode}:${serverRecord?.serverKey ?? serverKey ?? configServerId}:${deploymentId ?? 'create'}`;
  }

  function snapshotDeploymentWizardDraft(): DeploymentWizardDraftSnapshot {
    return {
      key: getDraftKey(),
      formType,
      sourcePath,
      deployName,
      syncMode,
      hotReload,
      healthCheckPath,
      ...(healthCheckTimeoutMs !== undefined ? { healthCheckTimeoutMs } : {}),
      ignoreGlobs: [...ignoreGlobs],
      ignoreGlobDraft,
      build: snapshotBuildConfig(),
      buildEnvDraft,
      hooks: cloneValue(hooks),
      lastInferredName,
      deployNameUserEdited,
    };
  }

  function restoreDeploymentWizardDraft(snapshot: DeploymentWizardDraftSnapshot): void {
    formType = snapshot.formType;
    sourcePath = snapshot.sourcePath;
    deployName = snapshot.deployName;
    syncMode = snapshot.syncMode;
    hotReload = snapshot.hotReload;
    healthCheckPath = snapshot.healthCheckPath;
    healthCheckTimeoutMs = snapshot.healthCheckTimeoutMs;
    ignoreGlobs = [...snapshot.ignoreGlobs];
    ignoreGlobDraft = snapshot.ignoreGlobDraft;
    buildEnvDraft = snapshot.buildEnvDraft ?? '';
    applyBuildConfig(snapshot.build);
    if (snapshot.buildEnvDraft !== undefined) {
      buildEnvDraft = snapshot.buildEnvDraft;
    }
    hooks = cloneValue(snapshot.hooks);
    lastInferredName = snapshot.lastInferredName;
    deployNameUserEdited = snapshot.deployNameUserEdited ?? false;
    errors = {};
    touched = {};
    submitState = 'idle';
    submitError = '';
    pendingRequestId = '';
  }

  function handleBack() {
    deploymentWizardDraft.set(null);
    spaState.update(s => ({ ...s, serverDetailResumeTab: 'deployments' }));
    activeEntity.set({
      type: 'server',
      id: serverRecord?.serverKey ?? serverKey ?? configServerId,
      serverId: configServerId,
      serverKey: serverRecord?.serverKey ?? serverKey,
      workspaceFolderUri: serverRecord?.workspaceFolderUri ?? workspaceFolderUri,
    });
  }

  function openHooksEditor(): void {
    const allowed = new Set(getDeploymentHookEvents());
    const filteredOptions = HOOK_EVENT_OPTIONS.filter(opt => allowed.has(opt.value));
    const snapshot = snapshotDeploymentWizardDraft();
    deploymentWizardDraft.set(snapshot);

    hooksEditorSession.set({
      draft: cloneValue(hooks),
      fieldName: 'hooks',
      commit: (next) => {
        const nextHooks = Array.isArray(next) ? cloneValue(next as HookConfig[]) : [];
        hooks = nextHooks;
        const current = get(deploymentWizardDraft);
        deploymentWizardDraft.set({
          ...(current?.key === snapshot.key ? current : snapshot),
          hooks: nextHooks,
        });
      },
      returnTarget: get(activeEntity),
      eventOptions: filteredOptions,
    });
    activeEntity.set({ type: 'hooks-editor' });
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
    if (buildEnabled) {
      if (buildTimeoutMs === undefined || !Number.isFinite(buildTimeoutMs) || buildTimeoutMs < 1000) {
        allErrors.buildTimeoutMs = 'Build timeout must be at least 1000 ms';
      }
      if (buildKind === 'command' && !buildCommandLine.trim()) {
        allErrors.buildCommandLine = 'Build command is required';
      }
      if (buildKind === 'vscodeTask' && !buildTaskName.trim()) {
        allErrors.buildTaskName = 'Task name is required';
      }
    }

    errors = allErrors;
    touched = {
      sourcePath: true,
      deployName: true,
      healthCheckTimeoutMs: healthCheckTimeoutMs !== undefined,
      buildTimeoutMs: buildEnabled,
      buildCommandLine: buildEnabled && buildKind === 'command',
      buildTaskName: buildEnabled && buildKind === 'vscodeTask',
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
      build: currentBuildConfig(),
      hooks: cloneValue(hooks),
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
        serverId: configServerId,
        serverKey: serverRecord.serverKey,
        workspaceFolderUri: serverRecord.workspaceFolderUri,
        workspaceFolderName: serverRecord.workspaceFolderName,
        deploymentId: draft.id,
        draft,
      }],
    });
  }
</script>

{#if config}
  <div class="deployment-wizard-root">
<FormPage
  variant="editor"
  backLabel="Deployments"
  onBack={handleBack}
  title={mode === 'create' ? 'Add Deployment' : 'Edit Deployment'}
  subtitle={pageSubtitle}
  alignStart={true}
>
  <svelte:fragment slot="actions">
    <ContextTag text={formType === 'exploded' ? 'EXPLODED' : 'WAR'} />
    <ContextTag text={String(config?.type || 'server').toUpperCase()} />
  </svelte:fragment>

  <div class="wizard-content">
    <div class="wizard-unified">
    <SectionBlock title="Source & Type">
      <div class="section-grid">
        <div class="form-field">
          <label class="field-label">Deployment Type</label>
          <ModeSelector
            ariaLabel="Deployment type"
            value={formType}
            onChange={(v) => (formType = v as 'exploded' | 'war')}
            options={[
              { value: 'exploded', label: 'Exploded Directory' },
              { value: 'war', label: 'WAR File' },
            ]}
          />
        </div>

        <!-- Source Path -->
        <div class="form-field">
          <label class="field-label" for="source-path">
            {formType === 'war' ? 'WAR File' : 'Source Path'} <span class="required">*</span>
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
            <p class="field-help">
              {formType === 'war'
                ? 'Path to the deployable WAR artifact.'
                : 'Path to the exploded directory.'}
            </p>
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
            oninput={handleDeployNameInput}
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
    </SectionBlock>

    <AdvancedCollapse title="Sync & Options" defaultOpen={true}>
      <div class="section-grid">
        <div class="form-field">
          <label class="field-label">Synchronization Mode</label>
          <div class="radio-group">
            <label class="radio-option" class:selected={syncMode === 'auto'}>
              <input type="radio" bind:group={syncMode} value="auto" />
              <div class="radio-content">
                <span class="radio-label">Auto</span>
                <span class="radio-desc">
                  Files sync automatically on save. Applies the lightest safe update and falls back when needed.
                </span>
              </div>
            </label>
            <label class="radio-option" class:selected={syncMode === 'manual'}>
              <input type="radio" bind:group={syncMode} value="manual" />
              <div class="radio-content">
                <span class="radio-label">Manual</span>
                <span class="radio-desc">You control redeploy from the dashboard or tree.</span>
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
                <span class="checkbox-desc">Apply changes without full redeploy. Only affects files outside WEB-INF and META-INF.</span>
              </div>
            </label>
          </div>
        {/if}
      </div>
    </AdvancedCollapse>

    <AdvancedCollapse title="Build before Deploy">
      <div class="section-grid">
        <div class="form-field full-width-field">
          <label class="checkbox-label">
            <input type="checkbox" class="field-checkbox" bind:checked={buildEnabled} />
            <div class="checkbox-content">
              <span class="checkbox-label-text">Run build before full deploy</span>
              <span class="checkbox-desc">Runs an explicit command or VS Code task before manual full deploy operations.</span>
            </div>
          </label>
        </div>

        {#if buildEnabled}
          <div class="form-field">
            <label class="field-label">Build Type</label>
            <ModeSelector
              ariaLabel="Build type"
              value={buildKind}
              onChange={(v) => (buildKind = v as 'command' | 'vscodeTask')}
              options={[
                { value: 'command', label: 'Command' },
                { value: 'vscodeTask', label: 'VS Code Task' },
              ]}
            />
          </div>

          <div class="form-field">
            <label class="field-label">Run On</label>
            <div class="radio-group">
              <label class="radio-option" class:selected={buildTrigger === 'manual'}>
                <input type="radio" bind:group={buildTrigger} value="manual" />
                <div class="radio-content">
                  <span class="radio-label">Manual deploys</span>
                  <span class="radio-desc">Deploy, redeploy all, and deploy on start. Autosync fallback skips this build.</span>
                </div>
              </label>
              <label class="radio-option" class:selected={buildTrigger === 'manualAndAuto'}>
                <input type="radio" bind:group={buildTrigger} value="manualAndAuto" />
                <div class="radio-content">
                  <span class="radio-label">Manual and autosync fallback</span>
                  <span class="radio-desc">Also runs when autosync must fall back to a full deploy.</span>
                </div>
              </label>
            </div>
          </div>

          <div class="form-field">
            <label class="field-label" for="build-timeout">Build Timeout (ms)</label>
            <input
              id="build-timeout"
              type="number"
              class="field-input"
              class:error={errors.buildTimeoutMs && touched.buildTimeoutMs}
              bind:value={buildTimeoutMs}
              min="1000"
              placeholder="60000"
            />
            {#if errors.buildTimeoutMs && touched.buildTimeoutMs}
              <p class="field-error">{errors.buildTimeoutMs}</p>
            {:else}
              <p class="field-help">Maximum time allowed for the build step.</p>
            {/if}
          </div>

          {#if buildKind === 'command'}
            <div class="form-field full-width-field">
              <label class="field-label" for="build-command">Command <span class="required">*</span></label>
              <input
                id="build-command"
                type="text"
                class="field-input"
                class:error={errors.buildCommandLine && touched.buildCommandLine}
                bind:value={buildCommandLine}
                oninput={() => handleFieldInput('buildCommandLine', buildCommandLine)}
                onblur={() => handleFieldBlur('buildCommandLine')}
                placeholder="mvn package"
              />
              {#if errors.buildCommandLine && touched.buildCommandLine}
                <p class="field-error">{errors.buildCommandLine}</p>
              {:else}
                <p class="field-help">Exact shell command to run. JSM does not infer build tools.</p>
              {/if}
            </div>

            <div class="form-field">
              <label class="field-label" for="build-cwd">Working Directory</label>
              <input
                id="build-cwd"
                type="text"
                class="field-input"
                bind:value={buildCommandCwd}
                placeholder="/workspace/app"
              />
              <p class="field-help">Optional. Defaults to the owning workspace folder.</p>
            </div>

            <div class="form-field">
              <label class="field-label" for="build-env">Environment</label>
              <textarea
                id="build-env"
                class="field-input build-env-input"
                bind:value={buildEnvDraft}
                placeholder={"MAVEN_OPTS=-Xmx1g\nJAVA_TOOL_OPTIONS=-Dfile.encoding=UTF-8"}
              ></textarea>
              <p class="field-help">Optional KEY=value entries, one per line.</p>
            </div>
          {:else}
            <div class="form-field full-width-field">
              <label class="field-label" for="build-task">Task Name <span class="required">*</span></label>
              <input
                id="build-task"
                type="text"
                class="field-input"
                class:error={errors.buildTaskName && touched.buildTaskName}
                bind:value={buildTaskName}
                oninput={() => handleFieldInput('buildTaskName', buildTaskName)}
                onblur={() => handleFieldBlur('buildTaskName')}
                placeholder="build"
              />
              {#if errors.buildTaskName && touched.buildTaskName}
                <p class="field-error">{errors.buildTaskName}</p>
              {:else}
                <p class="field-help">Name must match one VS Code task exactly.</p>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    </AdvancedCollapse>

    <AdvancedCollapse title="Advanced Options">
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

        <div class="form-field">
          <label class="field-label">Hooks</label>
          <div class="hooks-summary-row">
            <p class="hooks-summary">
              {hooks.length === 0 ? 'No hooks configured yet' : `${hooks.length} hook(s) configured`}
            </p>
            <button type="button" class="btn btn-secondary btn-sm" onclick={openHooksEditor}>
              Open Hooks Editor
            </button>
          </div>
          <p class="field-help">Configure terminal commands or VS Code tasks for deployment events.</p>
        </div>
      </div>
    </AdvancedCollapse>
    </div>
  </div>

  {#if submitError}
    <div class="feedback-banner error">
      <Icon name="error" size={16} />
      <span>{submitError}</span>
    </div>
  {/if}

  <svelte:fragment slot="footer">
    <button type="button" class="btn btn-secondary" onclick={handleBack} disabled={submitState === 'submitting'}>
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
        <span>Saving…</span>
      {:else}
        <Icon name="check" size={14} />
        <span>{mode === 'create' ? 'Add Deployment' : 'Save Changes'}</span>
      {/if}
    </button>
  </svelte:fragment>
</FormPage>
  </div>
{:else}
  <div class="empty-state">Server not found</div>
{/if}

<style>
  @import './wizardFormShared.css';

  .deployment-wizard-root {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    height: 100%;
  }

  .empty-state {
    padding: var(--jsm-space-xl);
    color: var(--jsm-color-fg-secondary);
    font-family: var(--jsm-font-family);
  }

  .hooks-summary-row {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-md);
    margin-top: var(--jsm-space-xs);
  }

  .hooks-summary {
    margin: 0;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg);
  }

  .build-env-input {
    min-height: 84px;
    resize: vertical;
    line-height: 1.4;
  }
</style>

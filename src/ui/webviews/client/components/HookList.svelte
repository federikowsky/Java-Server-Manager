<script lang="ts">
  import type { HookConfig, HookPhase, HookEvent, HookKind } from '@core/types';
  import type { FormFieldDef, FieldError } from '../../protocol';
  import {
    createDefaultHook,
    getHookCommandLine,
    normalizeHookList,
    toShellCommand,
    validateHookList,
    HOOK_EVENT_OPTIONS,
    HOOK_KIND_OPTIONS,
    HOOK_PHASE_OPTIONS,
  } from '../../hookForm';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';
  import KeyValueList from './inputs/KeyValueList.svelte';

  const { def, value, onChange, id }: {
    def: FormFieldDef;
    value: HookConfig[] | undefined;
    onChange: (v: HookConfig[]) => void;
    id: string;
  } = $props();

  let nextHookIndex = $state(1);
  let hookErrors = $state<FieldError[]>([]);
  let editingIndex = $state<number | null>(null);
  let addEvent = $state<HookConfig['event']>('lifecycle.start');
  let addPhase = $state<HookPhase>('pre');
  let addKind = $state<HookKind>('command');
  let addCommand = $state('');
  let addTaskName = $state('');
  let addTimeout = $state(60000);
  let addContinueOnError = $state(false);
  let addCwd = $state('');
  let addEnv = $state<Record<string, string>>({});

  const allowedEvents = $derived((def.hookOptions?.events ?? HOOK_EVENT_OPTIONS).map(option => option.value as HookConfig['event']));
  const eventOptions = $derived(def.hookOptions?.events ?? HOOK_EVENT_OPTIONS);
  const defaultEvent = $derived((def.hookOptions?.defaultEvent as HookConfig['event'] | undefined) ?? allowedEvents[0] ?? 'lifecycle.start');
  const taskOptions = $derived(def.hookOptions?.taskOptions ?? []);

  $effect(() => {
    const hooks = normalizeHookList(value, allowedEvents);
    nextHookIndex = Math.max(nextHookIndex, hooks.length + 1);
    hookErrors = validateHookList(value, def.name, allowedEvents);
  });

  function getHooks(): HookConfig[] {
    return normalizeHookList(value, allowedEvents);
  }

  function commit(hooks: HookConfig[]): void {
    onChange(hooks);
  }

  function addHook(): void {
    const hook = createDefaultHook(nextHookIndex, { event: addEvent });
    hook.phase = addPhase;
    hook.kind = addKind;
    hook.timeoutMs = addTimeout;
    hook.continueOnError = addContinueOnError;

    if (addKind === 'command') {
      const cmd = addCommand.trim();
      if (!cmd) return;
      hook.command = { mode: 'shell', line: cmd };
      if (addCwd.trim()) {
        hook.command.cwd = addCwd.trim();
      }
      if (Object.keys(addEnv).length > 0) {
        hook.command.env = { ...addEnv };
      }
      delete hook.vscodeTask;
    } else {
      const task = addTaskName.trim();
      if (!task) return;
      hook.vscodeTask = { taskName: task };
      delete hook.command;
    }

    commit([...getHooks(), hook]);
    nextHookIndex += 1;
    addCommand = '';
    addTaskName = '';
    addTimeout = 60000;
    addContinueOnError = false;
    addCwd = '';
    addEnv = {};
  }

  function removeHook(index: number): void {
    if (editingIndex === index) editingIndex = null;
    commit(getHooks().filter((_, hookIndex) => hookIndex !== index));
  }

  function toggleEdit(index: number): void {
    editingIndex = editingIndex === index ? null : index;
  }

  function updateHook(index: number, patch: Partial<HookConfig>): void {
    const hooks = getHooks();
    const current = hooks[index];
    const nextHook: HookConfig = {
      ...current,
      ...patch,
    };

    if (patch.kind === 'command') {
      delete nextHook.vscodeTask;
      nextHook.command = current.command ?? { mode: 'shell', line: '' };
    }

    if (patch.kind === 'vscodeTask') {
      delete nextHook.command;
      nextHook.vscodeTask = current.vscodeTask ?? { taskName: '' };
    }

    commit(hooks.map((hook, hookIndex) => hookIndex === index ? nextHook : hook));
  }

  function updateCommand(index: number, patch: Partial<NonNullable<HookConfig['command']>>): void {
    const hooks = getHooks();
    const current = hooks[index];
    updateHook(index, {
      command: {
        mode: 'shell',
        line: current.command?.line ?? '',
        ...(current.command?.cwd ? { cwd: current.command.cwd } : {}),
        ...(current.command?.env ? { env: current.command.env } : {}),
        ...patch,
      },
    });
  }

  function updateVsCodeTask(index: number, taskName: string): void {
    updateHook(index, {
      vscodeTask: { taskName },
    });
  }

  function getErrorMessages(field: string): string[] {
    return hookErrors.filter(error => error.field === field).map(error => error.message);
  }

  function fieldId(index: number, suffix: string): string {
    return `${id}-${index}-${suffix.replaceAll('.', '-')}`;
  }

  function getPhaseIcon(phase: HookPhase): IconName {
    switch (phase) {
      case 'pre': return 'play';
      case 'post': return 'check';
      case 'onError': return 'error';
    }
  }

  function getPhaseLabel(phase: HookPhase): string {
    switch (phase) {
      case 'pre': return 'Before';
      case 'post': return 'After';
      case 'onError': return 'On Error';
    }
  }

  function getEventLabel(event: HookEvent): string {
    const opt = eventOptions.find(o => o.value === event);
    return opt?.label ?? event;
  }

  function getCommandPreview(hook: HookConfig): string {
    if (hook.kind === 'vscodeTask') {
      return `task: ${hook.vscodeTask?.taskName ?? '(unnamed)'}`;
    }
    const line = getHookCommandLine(hook.command).trim();
    return line.length > 0 ? `$ ${line}` : '(no command)';
  }

  function updateCommandLine(index: number, line: string): void {
    const hooks = getHooks();
    const current = hooks[index];
    updateHook(index, {
      command: toShellCommand(line, current.command),
    });
  }
</script>

<div class="hook-list" id={id}>
  <!-- Hook Cards -->
  {#each getHooks() as hook, index (hook.id + index)}
    <div class="hook-card" class:editing={editingIndex === index}>
      <!-- Compact View -->
      <div class="hook-card-compact">
        <div class="hook-card-icon">
          <Icon name={getPhaseIcon(hook.phase)} size={14} />
        </div>
        <div class="hook-card-info">
          <span class="hook-card-title">{getPhaseLabel(hook.phase)} {getEventLabel(hook.event)}</span>
          <code class="hook-card-command">{getCommandPreview(hook)}</code>
        </div>
        <div class="hook-card-meta">
          <span class="hook-meta-badge">{hook.phase}</span>
          <span class="hook-meta-badge subtle">{hook.kind === 'command' ? 'shell' : 'task'}</span>
          <span class="hook-meta-badge subtle">{Math.round(hook.timeoutMs / 1000)}s</span>
        </div>
        <div class="hook-card-actions">
          <button type="button" class="icon-btn" onclick={() => toggleEdit(index)} title="Edit hook" aria-label="Edit hook">
            <Icon name="edit" size={14} />
          </button>
          <button type="button" class="icon-btn danger" onclick={() => removeHook(index)} title="Remove hook" aria-label="Remove hook">
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>

      <!-- Expanded Edit View -->
      {#if editingIndex === index}
        <div class="hook-card-expanded">
          <div class="hook-edit-grid">
            <div class="hook-field">
              <label class="field-label" for={fieldId(index, 'event')}>Event</label>
              <select
                id={fieldId(index, 'event')}
                class="field-input"
                value={hook.event}
                onchange={(e: Event) => updateHook(index, { event: (e.target as HTMLSelectElement).value as HookConfig['event'] })}
              >
                {#each eventOptions as option (option.value)}
                  <option value={option.value} selected={hook.event === option.value}>{option.label}</option>
                {/each}
              </select>
            </div>

            <div class="hook-field">
              <label class="field-label" for={fieldId(index, 'phase')}>Phase</label>
              <select
                id={fieldId(index, 'phase')}
                class="field-input"
                value={hook.phase}
                onchange={(e: Event) => updateHook(index, { phase: (e.target as HTMLSelectElement).value as HookConfig['phase'] })}
              >
                {#each HOOK_PHASE_OPTIONS as option (option.value)}
                  <option value={option.value} selected={hook.phase === option.value}>{option.label}</option>
                {/each}
              </select>
            </div>

            <div class="hook-field">
              <label class="field-label" for={fieldId(index, 'id')}>Hook ID</label>
              <input
                id={fieldId(index, 'id')}
                class="field-input"
                type="text"
                value={hook.id}
                oninput={(e: Event) => updateHook(index, { id: (e.target as HTMLInputElement).value })}
              />
              {#each getErrorMessages(`${def.name}[${index}].id`) as message (message)}
                <span class="field-error">{message}</span>
              {/each}
            </div>
          </div>

          {#if hook.kind === 'command'}
            <div class="hook-field">
              <label class="field-label" for={fieldId(index, 'command.line')}>Command</label>
              <textarea
                id={fieldId(index, 'command.line')}
                class="field-input field-textarea"
                rows="2"
                spellcheck="false"
                value={getHookCommandLine(hook.command)}
                oninput={(e: Event) => updateCommandLine(index, (e.target as HTMLTextAreaElement).value)}
              ></textarea>
              {#each getErrorMessages(`${def.name}[${index}].command.line`) as message (message)}
                <span class="field-error">{message}</span>
              {/each}
            </div>
          {:else}
            <div class="hook-field">
              <label class="field-label" for={fieldId(index, 'vscodeTask.taskName')}>Task Name</label>
              <input
                id={fieldId(index, 'vscodeTask.taskName')}
                class="field-input"
                type="text"
                list={fieldId(index, 'vscodeTask.taskName-options')}
                placeholder={taskOptions.length > 0 ? 'Type to filter available tasks' : 'Enter the task name'}
                value={hook.vscodeTask?.taskName ?? ''}
                oninput={(e: Event) => updateVsCodeTask(index, (e.target as HTMLInputElement).value)}
              />
              {#if taskOptions.length > 0}
                <datalist id={fieldId(index, 'vscodeTask.taskName-options')}>
                  {#each taskOptions as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </datalist>
              {/if}
              {#each getErrorMessages(`${def.name}[${index}].vscodeTask.taskName`) as message (message)}
                <span class="field-error">{message}</span>
              {/each}
            </div>
          {/if}

          <!-- Advanced Options -->
          <details class="hook-advanced">
            <summary>Advanced</summary>
            <div class="hook-advanced-content">
              <div class="hook-edit-grid">
                <div class="hook-field">
                  <label class="field-label" for={fieldId(index, 'timeoutMs')}>Timeout (ms)</label>
                  <input
                    id={fieldId(index, 'timeoutMs')}
                    class="field-input"
                    type="number"
                    min="1000"
                    step="1000"
                    value={hook.timeoutMs}
                    oninput={(e: Event) => updateHook(index, { timeoutMs: Number((e.target as HTMLInputElement).value) })}
                  />
                </div>

                {#if hook.kind === 'command'}
                  <div class="hook-field">
                    <label class="field-label" for={fieldId(index, 'command.cwd')}>Working Directory</label>
                    <input
                      id={fieldId(index, 'command.cwd')}
                      class="field-input"
                      type="text"
                      value={hook.command?.cwd ?? ''}
                      oninput={(e: Event) => updateCommand(index, { cwd: (e.target as HTMLInputElement).value })}
                    />
                  </div>
                {/if}

                <div class="hook-field hook-field-checkbox">
                  <label class="field-label">&nbsp;</label>
                  <label class="hook-toggle">
                    <input
                      class="field-checkbox"
                      type="checkbox"
                      checked={hook.continueOnError}
                      onchange={(e: Event) => updateHook(index, { continueOnError: (e.target as HTMLInputElement).checked })}
                    />
                    <span>Continue on error</span>
                  </label>
                </div>
              </div>

              {#if hook.kind === 'command'}
                <div class="hook-field">
                  <div class="field-label">Environment Variables</div>
                  <KeyValueList
                    id={fieldId(index, 'command.env')}
                    value={hook.command?.env ?? {}}
                    onChange={(env: Record<string, string>) => updateCommand(index, { env })}
                  />
                </div>
              {/if}
            </div>
          </details>

          <div class="hook-edit-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick={() => toggleEdit(index)}>
              Done
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/each}

  {#if getHooks().length === 0}
    <div class="hook-empty-state">No hooks configured. Add one below.</div>
  {/if}

  <!-- Add Hook Bar -->
  <div class="hook-add-bar">
    <div class="hook-add-main">
      <span class="hook-add-label">Add Hook</span>
      <select class="field-input hook-add-select" bind:value={addEvent}>
        {#each eventOptions as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
      <select class="field-input hook-add-select hook-add-phase" bind:value={addPhase}>
        {#each HOOK_PHASE_OPTIONS as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
      <select class="field-input hook-add-select hook-add-kind" bind:value={addKind}>
        {#each HOOK_KIND_OPTIONS as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
      {#if addKind === 'command'}
        <input
          type="text"
          class="field-input hook-add-input"
          placeholder="npm test"
          bind:value={addCommand}
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); addHook(); } }}
        />
      {:else}
        <select
          class="field-input hook-add-input"
          bind:value={addTaskName}
        >
          <option value="">Select a task...</option>
          {#each taskOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      {/if}
      <button
        type="button"
        class="btn btn-primary btn-sm"
        onclick={addHook}
        disabled={addKind === 'command' ? !addCommand.trim() : !addTaskName.trim()}
      >
        <Icon name="add" size={12} />
        <span>Add</span>
      </button>
    </div>
    <details class="hook-add-advanced">
      <summary>Advanced</summary>
      <div class="hook-add-advanced-content">
        <div class="hook-add-advanced-grid">
          <div class="hook-field">
            <label class="field-label">Timeout (ms)</label>
            <input type="number" class="field-input" bind:value={addTimeout} min="1000" step="1000" />
          </div>
          {#if addKind === 'command'}
            <div class="hook-field">
              <label class="field-label">Working Directory</label>
              <input type="text" class="field-input" placeholder="Optional" bind:value={addCwd} />
            </div>
          {/if}
          <div class="hook-field hook-field-checkbox">
            <label class="field-label">&nbsp;</label>
            <label class="hook-toggle">
              <input type="checkbox" class="field-checkbox" bind:checked={addContinueOnError} />
              <span>Continue on error</span>
            </label>
          </div>
        </div>
        {#if addKind === 'command'}
          <div class="hook-field">
            <div class="field-label">Environment Variables</div>
            <KeyValueList
              id="{id}-add-env"
              value={addEnv}
              onChange={(env: Record<string, string>) => addEnv = env}
            />
          </div>
        {/if}
      </div>
    </details>
  </div>
</div>

<style>
  .hook-list {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-sm);
  }

  .hook-empty-state {
    padding: var(--jsm-space-lg);
    text-align: center;
    color: var(--jsm-color-fg-muted);
    font-size: var(--jsm-font-size-sm);
    font-style: italic;
    border: 1px dashed var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-md);
  }

  /* Hook Card — Compact */
  .hook-card {
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-md);
    background: var(--jsm-color-bg);
    overflow: hidden;
  }

  .hook-card.editing {
    border-color: var(--jsm-color-border-focus);
  }

  .hook-card-compact {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-sm) var(--jsm-space-md);
  }

  .hook-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--jsm-radius-sm);
    background: var(--jsm-color-bg-secondary);
    color: var(--jsm-color-fg-secondary);
    flex-shrink: 0;
  }

  .hook-card-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hook-card-title {
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hook-card-command {
    font-size: var(--jsm-font-size-xs);
    font-family: var(--vscode-editor-font-family, var(--jsm-font-family));
    color: var(--jsm-color-fg-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hook-card-meta {
    display: flex;
    gap: var(--jsm-space-2xs);
    flex-shrink: 0;
  }

  .hook-meta-badge {
    padding: 2px var(--jsm-space-xs);
    border-radius: var(--jsm-radius-sm);
    font-size: 10px;
    font-weight: var(--jsm-font-weight-medium);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    background: var(--jsm-color-bg-secondary);
    color: var(--jsm-color-fg-secondary);
    border: 1px solid var(--jsm-color-border-secondary);
  }

  .hook-meta-badge.subtle {
    background: transparent;
    border-color: transparent;
  }

  .hook-card-actions {
    display: flex;
    gap: var(--jsm-space-2xs);
    flex-shrink: 0;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--jsm-radius-sm);
    background: transparent;
    color: var(--jsm-color-fg-secondary);
    cursor: pointer;
    transition: all var(--jsm-transition-fast);
  }

  .icon-btn:hover {
    background: var(--jsm-color-bg-hover);
    color: var(--jsm-color-fg);
  }

  .icon-btn.danger:hover {
    background: color-mix(in srgb, var(--jsm-color-error) 15%, transparent);
    color: var(--jsm-color-error);
  }

  /* Hook Card — Expanded Edit */
  .hook-card-expanded {
    padding: var(--jsm-space-md);
    border-top: 1px solid var(--jsm-color-border-secondary);
    background: var(--jsm-color-bg-secondary);
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-md);
  }

  .hook-edit-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--jsm-space-sm) var(--jsm-space-md);
  }

  .hook-field {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-2xs);
  }

  .hook-field-checkbox {
    justify-content: flex-end;
    padding-top: calc(var(--jsm-font-size-md) + var(--jsm-space-2xs));
  }

  .hook-advanced {
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-md);
    background: var(--jsm-color-bg);
  }

  .hook-advanced summary {
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg-secondary);
    cursor: pointer;
    user-select: none;
  }

  .hook-advanced summary:hover {
    color: var(--jsm-color-fg);
  }

  .hook-advanced-content {
    padding: 0 var(--jsm-space-md) var(--jsm-space-md);
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-sm);
  }

  .hook-toggle {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    cursor: pointer;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg);
  }

  .hook-edit-actions {
    display: flex;
    justify-content: flex-end;
  }

  /* Add Hook Bar */
  .hook-add-bar {
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-md);
    background: var(--jsm-color-bg);
    overflow: hidden;
  }

  .hook-add-main {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-sm) var(--jsm-space-md);
  }

  .hook-add-label {
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg-secondary);
    white-space: nowrap;
  }

  .hook-add-select {
    width: auto;
    min-width: 120px;
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
  }

  .hook-add-phase {
    min-width: 80px;
  }

  .hook-add-kind {
    min-width: 100px;
  }

  .hook-add-input {
    flex: 1;
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
    font-family: var(--vscode-editor-font-family, var(--jsm-font-family));
  }

  .hook-add-advanced {
    border-top: 1px solid var(--jsm-color-border-secondary);
  }

  .hook-add-advanced summary {
    padding: var(--jsm-space-xs) var(--jsm-space-md);
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg-muted);
    cursor: pointer;
    user-select: none;
  }

  .hook-add-advanced summary:hover {
    color: var(--jsm-color-fg-secondary);
  }

  .hook-add-advanced-content {
    padding: 0 var(--jsm-space-md) var(--jsm-space-sm);
  }

  .hook-add-advanced-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--jsm-space-sm);
  }

  .btn-sm {
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
  }

  @media (max-width: 600px) {
    .hook-edit-grid {
      grid-template-columns: 1fr;
    }

    .hook-add-bar {
      flex-wrap: wrap;
    }

    .hook-add-select {
      min-width: 100px;
    }
  }
</style>
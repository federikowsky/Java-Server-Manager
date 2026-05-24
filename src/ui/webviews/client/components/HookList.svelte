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
  import KeyValueList from './inputs/KeyValueList.svelte';
  import SectionBlock from './ds/SectionBlock.svelte';
  import AdvancedCollapse from './ds/AdvancedCollapse.svelte';

  const { def, value, onChange, id, onTest, testState }: {
    def: FormFieldDef;
    value: HookConfig[] | undefined;
    onChange: (v: HookConfig[]) => void;
    id: string;
    onTest?: (hook: HookConfig, index: number) => void;
    testState?: { index: number; status: 'running' | 'succeeded' | 'failed'; message?: string } | null;
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
  let hooks = $state<HookConfig[]>([]);

  const allowedEvents = $derived((def.hookOptions?.events ?? HOOK_EVENT_OPTIONS).map(option => option.value as HookConfig['event']));
  const eventOptions = $derived(def.hookOptions?.events ?? HOOK_EVENT_OPTIONS);
  const taskOptions = $derived(def.hookOptions?.taskOptions ?? []);

  $effect(() => {
    const normalizedHooks = normalizeHookList(value, allowedEvents);
    hooks = normalizedHooks;
    nextHookIndex = Math.max(nextHookIndex, normalizedHooks.length + 1);
    hookErrors = validateHookList(value, def.name, allowedEvents);
  });

  function getHooks(): HookConfig[] {
    return hooks;
  }

  function commit(nextHooks: HookConfig[]): void {
    const normalizedHooks = normalizeHookList(nextHooks, allowedEvents);
    hooks = normalizedHooks;
    hookErrors = validateHookList(normalizedHooks, def.name, allowedEvents);
    onChange(normalizedHooks);
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

  function getPhaseLabel(phase: HookPhase): string {
    return HOOK_PHASE_OPTIONS.find(o => o.value === phase)?.label ?? phase;
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

  function getCommandCell(hook: HookConfig): string {
    return getCommandPreview(hook).replace(/^\$\s+/, '');
  }

  function getTypeLabel(kind: HookKind): string {
    const opt = HOOK_KIND_OPTIONS.find(o => o.value === kind);
    return opt?.label ?? kind;
  }

  function updateCommandLine(index: number, line: string): void {
    const hooks = getHooks();
    const current = hooks[index];
    updateHook(index, {
      command: toShellCommand(line, current.command),
    });
  }
</script>

<div class="hook-list-root" id={id}>
  <SectionBlock title="Existing Hooks">
    <div class="hook-rows" role="list">
      {#if getHooks().length > 0}
        <div class="hook-spec-head" aria-hidden="true">
          <span>Event</span>
          <span>Phase</span>
          <span>Type</span>
          <span>Command</span>
          <span class="hook-spec-actions-h"> </span>
        </div>
      {/if}
      {#each getHooks() as hook, index (hook.id + index)}
        <div class="hook-row" class:editing={editingIndex === index} role="listitem">
          <div class="hook-spec-row">
            <span class="hook-spec-cell">{getEventLabel(hook.event)}</span>
            <span class="hook-spec-cell">{getPhaseLabel(hook.phase)}</span>
            <span class="hook-spec-cell">{getTypeLabel(hook.kind)}</span>
            <code class="hook-spec-cell hook-spec-cmd">{getCommandCell(hook)}</code>
            <div class="hook-spec-actions">
              <button type="button" class="hook-text-action" onclick={() => toggleEdit(index)}>
                Edit
              </button>
              {#if onTest}
                <span class="hook-action-sep" aria-hidden="true">|</span>
                <button
                  type="button"
                  class="hook-text-action"
                  onclick={() => onTest?.(hook, index)}
                  disabled={testState?.status === 'running'}
                >
                  Test
                </button>
              {/if}
              <span class="hook-action-sep" aria-hidden="true">|</span>
              <button type="button" class="hook-text-action hook-text-action-danger" onclick={() => removeHook(index)}>
                Remove
              </button>
            </div>
          </div>
          {#if testState?.index === index}
            <p class={`hook-test-status hook-test-status-${testState.status}`}>
              {testState.status === 'running' ? 'Testing hook...' : testState.message}
            </p>
          {/if}

          {#if editingIndex === index}
        <div class="hook-row-expanded">
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
      {:else}
        <p class="hook-empty">No hooks configured</p>
      {/each}
    </div>
  </SectionBlock>

  <SectionBlock title="Add Hook">
    <div class="hook-add-stack">
    <div class="hook-spec-head hook-add-head" aria-hidden="true">
      <span>Event</span>
      <span>Phase</span>
      <span>Type</span>
      <span>Command</span>
      <span class="hook-spec-actions-h"> </span>
    </div>
    <div class="hook-add-main">
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
        class="btn btn-primary btn-sm hook-add-submit"
        onclick={addHook}
        disabled={addKind === 'command' ? !addCommand.trim() : !addTaskName.trim()}
      >
        Add
      </button>
    </div>
    <AdvancedCollapse title="Advanced">
      <div class="hook-add-adv-inline">
        <div class="hook-field hook-field-inline">
          <label class="field-label" for={`${id}-add-timeout`}>Timeout (ms)</label>
          <input id={`${id}-add-timeout`} type="number" class="field-input" bind:value={addTimeout} min="1000" step="1000" />
        </div>
        {#if addKind === 'command'}
          <div class="hook-field hook-field-inline">
            <label class="field-label" for={`${id}-add-cwd`}>Working Directory</label>
            <input id={`${id}-add-cwd`} type="text" class="field-input" placeholder="Optional" bind:value={addCwd} />
          </div>
        {/if}
        <label class="hook-toggle hook-toggle-inline">
          <input type="checkbox" class="field-checkbox" bind:checked={addContinueOnError} />
          <span>Continue on error</span>
        </label>
      </div>
      {#if addKind === 'command'}
        <div class="hook-field hook-env-below">
          <div class="field-label">Environment Variables</div>
          <KeyValueList
            id={`${id}-add-env`}
            value={addEnv}
            onChange={(env: Record<string, string>) => addEnv = env}
          />
        </div>
      {/if}
    </AdvancedCollapse>
    </div>
  </SectionBlock>
</div>

<style>
  .hook-list-root {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-md);
    min-width: 0;
  }

  .hook-rows {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .hook-empty {
    margin: 0;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-muted);
  }

  .hook-row {
    border-bottom: 1px solid var(--jsm-color-border-secondary);
    padding: var(--jsm-space-sm) 0;
  }

  .hook-row:last-child {
    border-bottom: none;
  }

  .hook-row.editing {
    padding-bottom: 0;
  }

  .hook-spec-head,
  .hook-spec-row {
    display: grid;
    grid-template-columns: minmax(5rem, 1.1fr) minmax(3.5rem, 0.55fr) minmax(4rem, 0.65fr) minmax(0, 1.35fr) auto;
    gap: var(--jsm-space-sm);
    align-items: center;
    font-size: var(--jsm-font-size-sm);
  }

  .hook-spec-head {
    padding: 0 0 var(--jsm-space-2xs);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--jsm-color-border-secondary);
  }

  .hook-add-head {
    margin-bottom: var(--jsm-space-2xs);
  }

  .hook-spec-cell {
    min-width: 0;
    color: var(--jsm-color-fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hook-spec-cmd {
    font-family: var(--vscode-editor-font-family, var(--jsm-font-family));
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-secondary);
  }

  .hook-spec-actions,
  .hook-spec-actions-h {
    justify-self: end;
    white-space: nowrap;
  }

  .hook-spec-actions {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-xs);
  }

  .hook-action-sep {
    color: var(--jsm-color-border-secondary);
    font-size: var(--jsm-font-size-xs);
    user-select: none;
  }

  .hook-text-action {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-size: var(--jsm-font-size-sm);
    color: var(--vscode-textLink-foreground, var(--jsm-color-accent));
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .hook-text-action:disabled {
    cursor: default;
    color: var(--jsm-color-fg-muted);
    text-decoration: none;
  }

  .hook-text-action:hover {
    color: var(--vscode-textLink-activeForeground, var(--jsm-color-fg));
  }

  .hook-text-action-danger {
    color: var(--jsm-color-error);
  }

  .hook-text-action-danger:hover {
    color: color-mix(in srgb, var(--jsm-color-error) 85%, var(--jsm-color-fg));
  }

  .hook-row-expanded {
    margin-top: var(--jsm-space-md);
    padding: var(--jsm-space-md);
    border-radius: var(--jsm-radius-md);
    border: 1px solid var(--jsm-color-border-secondary);
    background: var(--jsm-color-bg-secondary);
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-md);
  }

  .hook-test-status {
    margin: var(--jsm-space-2xs) 0 0;
    font-size: var(--jsm-font-size-xs);
    color: var(--jsm-color-fg-muted);
  }

  .hook-test-status-succeeded {
    color: var(--jsm-color-success);
  }

  .hook-test-status-failed {
    color: var(--jsm-color-error);
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

  .hook-add-stack {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-sm);
    min-width: 0;
  }

  .hook-add-main {
    display: grid;
    grid-template-columns: minmax(5rem, 1.1fr) minmax(3.5rem, 0.55fr) minmax(4rem, 0.65fr) minmax(0, 1.35fr) auto;
    gap: var(--jsm-space-sm);
    align-items: center;
    padding: var(--jsm-space-xs) 0;
    min-width: 0;
  }

  .hook-add-submit {
    justify-self: end;
  }

  .hook-add-adv-inline {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--jsm-space-md);
    margin-bottom: var(--jsm-space-sm);
  }

  .hook-field-inline {
    flex: 1;
    min-width: 8rem;
  }

  .hook-toggle-inline {
    display: inline-flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    cursor: pointer;
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg);
    margin-bottom: var(--jsm-space-2xs);
    white-space: nowrap;
  }

  .hook-env-below {
    margin-top: var(--jsm-space-sm);
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

  .btn-sm {
    padding: var(--jsm-space-xs) var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
  }

  @media (max-width: 600px) {
    .hook-edit-grid {
      grid-template-columns: 1fr;
    }

    .hook-add-main {
      flex-wrap: wrap;
    }

    .hook-add-select {
      min-width: 100px;
    }
  }
</style>

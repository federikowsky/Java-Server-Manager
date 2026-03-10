<script lang="ts">
  import type { HookConfig } from '@core/types';
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
  import KeyValueList from './inputs/KeyValueList.svelte';

  const { def, value, onChange, id }: {
    def: FormFieldDef;
    value: HookConfig[] | undefined;
    onChange: (v: HookConfig[]) => void;
    id: string;
  } = $props();

  let nextHookIndex = $state(1);
  let hookErrors = $state<FieldError[]>([]);
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
    commit([...getHooks(), createDefaultHook(nextHookIndex, { event: defaultEvent })]);
    nextHookIndex += 1;
  }

  function removeHook(index: number): void {
    commit(getHooks().filter((_, hookIndex) => hookIndex !== index));
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

  function getHookTitle(hook: HookConfig, index: number): string {
    if (hook.kind === 'vscodeTask') {
      const taskName = hook.vscodeTask?.taskName?.trim();
      return taskName && taskName.length > 0 ? taskName : `VS Code Task ${index + 1}`;
    }

    const line = getHookCommandLine(hook.command).trim();
    return line.length > 0 ? line : `Terminal Hook ${index + 1}`;
  }

  function getHookSubtitle(hook: HookConfig): string {
    return `${hook.phase} • ${hook.event} • ${hook.id}`;
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
  {#if getHooks().length === 0}
    <div class="hook-empty-state">No hooks configured yet.</div>
  {/if}

  {#each getHooks() as hook, index (hook.id + index)}
    <div class="hook-card">
      <div class="hook-card-header">
        <div>
          <div class="hook-card-title">{getHookTitle(hook, index)}</div>
          <div class="hook-card-subtitle">{getHookSubtitle(hook)}</div>
        </div>
        <button type="button" class="btn btn-secondary hook-remove" onclick={() => removeHook(index)}>
          Remove
        </button>
      </div>

      <div class="hook-grid">
        <div class="hook-field">
          <label class="field-label" for={fieldId(index, 'id')}>Hook ID</label>
          <input
            id={fieldId(index, 'id')}
            class="field-input"
            type="text"
            value={hook.id}
            oninput={(e: Event) => updateHook(index, { id: (e.target as HTMLInputElement).value })}
          />
          <span class="field-help">Technical identifier used in logs, diagnostics, and failures. It starts with a default Hook-N value and remains editable.</span>
          {#each getErrorMessages(`${def.name}[${index}].id`) as message (message)}
            <span class="hook-field-error">{message}</span>
          {/each}
        </div>

        <div class="hook-field">
          <label class="field-label" for={fieldId(index, 'phase')}>Phase</label>
          <select
            id={fieldId(index, 'phase')}
            class="field-input"
            onchange={(e: Event) => updateHook(index, { phase: (e.target as HTMLSelectElement).value as HookConfig['phase'] })}
          >
            {#each HOOK_PHASE_OPTIONS as option (option.value)}
              <option value={option.value} selected={hook.phase === option.value}>{option.label}</option>
            {/each}
          </select>
        </div>

        <div class="hook-field">
          <label class="field-label" for={fieldId(index, 'event')}>Event</label>
          <select
            id={fieldId(index, 'event')}
            class="field-input"
            onchange={(e: Event) => updateHook(index, { event: (e.target as HTMLSelectElement).value as HookConfig['event'] })}
          >
            {#each eventOptions as option (option.value)}
              <option value={option.value} selected={hook.event === option.value}>{option.label}</option>
            {/each}
          </select>
        </div>

        <div class="hook-field">
          <label class="field-label" for={fieldId(index, 'kind')}>Kind</label>
          <select
            id={fieldId(index, 'kind')}
            class="field-input"
            onchange={(e: Event) => updateHook(index, { kind: (e.target as HTMLSelectElement).value as HookConfig['kind'] })}
          >
            {#each HOOK_KIND_OPTIONS as option (option.value)}
              <option value={option.value} selected={hook.kind === option.value}>{option.label}</option>
            {/each}
          </select>
        </div>

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
          {#each getErrorMessages(`${def.name}[${index}].timeoutMs`) as message (message)}
            <span class="hook-field-error">{message}</span>
          {/each}
        </div>
      </div>

      <div class="hook-toggle-row">
        <label class="hook-toggle">
          <input
            class="field-checkbox"
            type="checkbox"
            checked={hook.enabled}
            onchange={(e: Event) => updateHook(index, { enabled: (e.target as HTMLInputElement).checked })}
          />
          <span>Enabled</span>
        </label>
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

      {#if hook.kind === 'command'}
        <div class="hook-subsection">
          <div class="hook-subsection-title">Terminal Command</div>

          <div class="hook-field">
            <label class="field-label" for={fieldId(index, 'command.line')}>Command Line</label>
            <textarea
              id={fieldId(index, 'command.line')}
              class="field-input field-textarea"
              rows="3"
              spellcheck="false"
              value={getHookCommandLine(hook.command)}
              oninput={(e: Event) => updateCommandLine(index, (e.target as HTMLTextAreaElement).value)}
            ></textarea>
            <!-- <span class="field-help">Runs in a shell, so operators like &&, ||, pipes, and redirects work as expected.</span> -->
            {#each getErrorMessages(`${def.name}[${index}].command.line`) as message (message)}
              <span class="hook-field-error">{message}</span>
            {/each}
          </div>

          <div class="hook-grid">
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
          </div>

          <div class="hook-field">
            <div class="field-label">Environment Variables</div>
            <KeyValueList
              id={fieldId(index, 'command.env')}
              value={hook.command?.env ?? {}}
              onChange={(env: Record<string, string>) => updateCommand(index, { env })}
            />
          </div>
        </div>
      {:else}
        <div class="hook-subsection">
          <div class="hook-subsection-title">VS Code Task</div>
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
              <span class="field-help">Start typing to filter the tasks currently available in the workspace.</span>
            {/if}
            {#each getErrorMessages(`${def.name}[${index}].vscodeTask.taskName`) as message (message)}
              <span class="hook-field-error">{message}</span>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/each}

  <button type="button" class="btn btn-secondary hook-add" onclick={addHook}>
    Add Hook
  </button>
</div>
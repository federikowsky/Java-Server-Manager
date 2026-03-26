<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { HookConfig } from '@core/types';
  import { activeEntity, spaState } from '../../stores';
  import BackControl from '../ds/BackControl.svelte';
  import SectionBlock from '../ds/SectionBlock.svelte';
  import DetailRows from '../ds/DetailRows.svelte';
  import Icon from '../Icon.svelte';

  const { templateId }: { templateId: string } = $props();

  let state = $state($spaState);
  const unsub = spaState.subscribe(s => {
    state = s;
  });

  onDestroy(() => unsub());

  let tpl = $derived(state.templates.find(t => t.template.id === templateId));
  let t = $derived(tpl?.template as Record<string, unknown> | undefined);
  let defaults = $derived((t?.serverDefaults ?? {}) as Record<string, unknown>);
  let runtime = $derived((defaults.runtime ?? {}) as Record<string, unknown>);
  let ports = $derived((defaults.ports ?? {}) as Record<string, unknown>);

  function goTemplatesIndex(): void {
    activeEntity.set({ type: 'templates-index' });
  }

  function goEdit(): void {
    activeEntity.set({ type: 'edit-template', id: templateId });
  }

  let scopeDisplay = $derived(
    tpl?.scope === 'global'
      ? 'Global'
      : tpl?.scope === 'workspace'
        ? 'Workspace'
        : String(tpl?.scope ?? ''),
  );

  let detailRows = $derived(
    t
      ? [
          { label: 'Name', value: String(t.name ?? '') },
          { label: 'Scope', value: scopeDisplay },
          { label: 'Server Type', value: String(t.pluginType ?? '') },
          { label: 'Description', value: String(t.description ?? '—') },
        ]
      : [],
  );

  let provisionRows = $derived([
    { label: 'Runtime Home', value: String(runtime.homePath ?? '—') },
    { label: 'JAVA_HOME', value: String(defaults.javaHome ?? '—') },
    { label: 'HTTP Port', value: String(ports.http ?? '—') },
    { label: 'Debug Port', value: String(ports.debug ?? '—') },
  ]);

  let templateHooks = $derived.by((): HookConfig[] => {
    const raw = defaults.hooks;
    if (!Array.isArray(raw) || raw.length === 0) {
      return [];
    }
    return raw as HookConfig[];
  });

  function hookDetailRows(h: HookConfig): { label: string; value: string }[] {
    const typeLabel = h.kind === 'vscodeTask' ? 'VS Code task' : 'Shell command';
    const rows: { label: string; value: string }[] = [
      { label: 'Event', value: String(h.event ?? '—') },
      { label: 'Phase', value: String(h.phase ?? '—') },
      { label: 'Type', value: typeLabel },
      { label: 'Enabled', value: h.enabled !== false ? 'Yes' : 'No' },
    ];
    if (h.kind === 'vscodeTask') {
      rows.push({ label: 'Task', value: (h.vscodeTask?.taskName ?? '').trim() || '—' });
    } else {
      rows.push({ label: 'Command', value: (h.command?.line ?? '').trim() || '—' });
    }
    rows.push({ label: 'Timeout', value: `${Number.isFinite(h.timeoutMs) ? h.timeoutMs : 60_000} ms` });
    if (h.continueOnError === true) {
      rows.push({ label: 'On error', value: 'Continue' });
    }
    return rows;
  }
</script>

{#if tpl && t}
  <div class="tpl-readonly jsm-page-padding jsm-stack-lg">
    <div class="tpl-top">
      <BackControl label="Templates" onBack={goTemplatesIndex} />
      <div class="tpl-actions">
        <button type="button" class="btn btn-primary" onclick={goEdit}>
          <Icon name="edit" size={14} />
          <span>Edit</span>
        </button>
      </div>
    </div>

    <header class="tpl-head">
      <h1 class="jsm-type-page-title">{String(t.name ?? '')}</h1>
      <p class="jsm-type-meta">
        {scopeDisplay} template · {String(t.pluginType ?? '')}
      </p>
    </header>

    <SectionBlock title="Details">
      <DetailRows rows={detailRows} />
    </SectionBlock>

    <SectionBlock title="Provisioning Defaults">
      <DetailRows rows={provisionRows} />
    </SectionBlock>

    {#if templateHooks.length > 0}
      <SectionBlock title="Hooks">
        <p class="hooks-lead jsm-type-meta">
          {templateHooks.length} hook{templateHooks.length === 1 ? '' : 's'} in provisioning defaults
        </p>
        <div class="tpl-hooks-list">
          {#each templateHooks as hook, idx (hook.id ? `${hook.id}-${idx}` : `hook-${idx}`)}
            <div class="tpl-hook-entry">
              <p class="tpl-hook-title">{String(hook.id || `Hook ${idx + 1}`)}</p>
              <DetailRows rows={hookDetailRows(hook)} />
            </div>
          {/each}
        </div>
      </SectionBlock>
    {/if}
  </div>
{:else}
  <div class="tpl-readonly jsm-page-padding">
    <BackControl label="Templates" onBack={goTemplatesIndex} />
    <p class="jsm-type-meta">Template not found</p>
  </div>
{/if}

<style>
  .tpl-readonly {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .tpl-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--jsm-space-md);
  }
  .tpl-actions {
    display: flex;
    gap: var(--jsm-space-sm);
    padding-top: var(--jsm-space-xs);
  }
  .tpl-head {
    margin-bottom: var(--jsm-space-sm);
  }

  .hooks-lead {
    margin: 0 0 var(--jsm-space-md);
  }

  .tpl-hooks-list {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-lg);
  }

  .tpl-hook-entry {
    padding-top: var(--jsm-space-md);
    border-top: 1px solid var(--jsm-color-border-secondary);
  }

  .tpl-hook-entry:first-child {
    padding-top: 0;
    border-top: none;
  }

  .tpl-hook-title {
    margin: 0 0 var(--jsm-space-sm);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }
</style>

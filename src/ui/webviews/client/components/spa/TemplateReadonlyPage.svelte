<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { HookConfig } from '@core/types';
  import { activeEntity, spaState } from '../../stores';
  import { sendDeleteTemplate } from '../../bridge';
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

  let tpl = $derived(
    state.templates.find(entry => {
      const doc = entry.template as { id?: string } | undefined;
      return typeof doc?.id === 'string' && doc.id === templateId;
    }),
  );
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

  function deleteTemplate(): void {
    if (!tpl) return;
    const scope = tpl.scope;
    if (scope !== 'global' && scope !== 'workspace') return;
    sendDeleteTemplate(templateId, scope);
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

  function hookKindLabel(h: HookConfig): string {
    return h.kind === 'vscodeTask' ? 'VS Code task' : 'Shell command';
  }

  function hookActionLabel(h: HookConfig): string {
    if (h.kind === 'vscodeTask') {
      return (h.vscodeTask?.taskName ?? '').trim() || '—';
    }
    return (h.command?.line ?? '').trim() || '—';
  }

  function hookTimeoutLabel(h: HookConfig): string {
    return `${Number.isFinite(h.timeoutMs) ? h.timeoutMs : 60_000} ms`;
  }
</script>

{#if tpl && t}
  <div class="tpl-readonly jsm-page-padding jsm-stack-lg">
    <div class="tpl-top">
      <BackControl label="Templates" onBack={goTemplatesIndex} />
      <div class="tpl-actions">
        <button type="button" class="btn btn-secondary tpl-btn-delete" onclick={deleteTemplate}>
          <Icon name="trash" size={14} />
          <span>Delete</span>
        </button>
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
        <ul class="tpl-hooks-list" role="list">
          {#each templateHooks as hook, idx (hook.id ? `${hook.id}-${idx}` : `hook-${idx}`)}
            <li class="tpl-hook-entry">
              <div class="tpl-hook-row">
                <span class="tpl-hook-name">{String(hook.id || `Hook ${idx + 1}`)}</span>
                <span class="tpl-hook-inline" aria-label="Hook details">
                  <span class="tpl-hook-chip">{String(hook.event ?? '—')} · {String(hook.phase ?? '—')}</span>
                  <span class="tpl-hook-chip">{hookKindLabel(hook)} · {hookActionLabel(hook)}</span>
                  <span class="tpl-hook-chip tpl-hook-chip--muted">{hookTimeoutLabel(hook)}</span>
                  {#if hook.continueOnError === true}
                    <span class="tpl-hook-chip tpl-hook-chip--muted">on error: continue</span>
                  {/if}
                </span>
              </div>
            </li>
          {/each}
        </ul>
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
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--jsm-space-sm);
    padding-top: var(--jsm-space-xs);
  }

  .tpl-btn-delete {
    color: var(--jsm-color-error, var(--vscode-errorForeground, #f14c4c));
    border-color: color-mix(in srgb, var(--jsm-color-error, #f14c4c) 45%, var(--jsm-color-border-secondary));
  }

  .tpl-btn-delete:hover:not(:disabled) {
    background: color-mix(in srgb, var(--jsm-color-error, #f14c4c) 12%, transparent);
  }
  .tpl-head {
    margin-bottom: var(--jsm-space-sm);
  }

  .hooks-lead {
    margin: 0 0 var(--jsm-space-sm);
  }

  .tpl-hooks-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-sm);
  }

  .tpl-hook-entry {
    padding-top: var(--jsm-space-sm);
    border-top: 1px solid var(--jsm-color-border-secondary);
  }

  .tpl-hook-entry:first-child {
    padding-top: 0;
    border-top: none;
  }

  .tpl-hook-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--jsm-space-xs) var(--jsm-space-sm);
  }

  .tpl-hook-name {
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
    flex: 0 0 auto;
  }

  .tpl-hook-inline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--jsm-space-2xs) var(--jsm-space-sm);
    min-width: 0;
    flex: 1 1 12rem;
  }

  .tpl-hook-chip {
    font-size: var(--jsm-font-size-xs);
    line-height: var(--jsm-line-height-tight, 1.35);
    color: var(--jsm-color-fg-secondary);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tpl-hook-chip--muted {
    opacity: 0.92;
  }
</style>

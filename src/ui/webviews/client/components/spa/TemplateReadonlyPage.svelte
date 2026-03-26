<script lang="ts">
  import { onDestroy } from 'svelte';
  import { activeEntity, spaState } from '../../stores';
  import BackControl from '../ds/BackControl.svelte';
  import SectionBlock from '../ds/SectionBlock.svelte';
  import DetailRows from '../ds/DetailRows.svelte';
  import ContextTag from '../ds/ContextTag.svelte';

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

  let detailRows = $derived(
    t
      ? [
          { label: 'Name', value: String(t.name ?? '') },
          { label: 'Scope', value: String(tpl?.scope ?? '') },
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
</script>

{#if tpl && t}
  <div class="tpl-readonly jsm-page-padding jsm-stack-lg">
    <div class="tpl-top">
      <BackControl label="Templates" onBack={goTemplatesIndex} />
      <div class="tpl-actions">
        <button type="button" class="btn-sec" onclick={goEdit}>Edit</button>
      </div>
    </div>

    <header class="tpl-head">
      <h1 class="jsm-type-page-title">{String(t.name ?? '')}</h1>
      <p class="jsm-type-meta">
        {tpl.scope} template · {String(t.pluginType ?? '')}
      </p>
      <div class="tpl-tags">
        <ContextTag text={String(t.pluginType ?? '').toUpperCase()} />
      </div>
    </header>

    <SectionBlock title="Details">
      <DetailRows rows={detailRows} />
    </SectionBlock>

    <SectionBlock title="Provisioning Defaults">
      <DetailRows rows={provisionRows} />
    </SectionBlock>
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
  .tpl-tags {
    margin-top: var(--jsm-space-sm);
  }
</style>

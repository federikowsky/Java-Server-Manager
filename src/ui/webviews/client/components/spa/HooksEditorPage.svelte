<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import type { FormFieldDef } from '../../../protocol';
  import { hooksEditorSession, activeEntity, spaState } from '../../stores';
  import HookList from '../HookList.svelte';
  import BackControl from '../ds/BackControl.svelte';

  let state = $state($spaState);
  const unsubState = spaState.subscribe(s => {
    state = s;
  });

  let session = $state($hooksEditorSession);
  const unsubSession = hooksEditorSession.subscribe(s => {
    session = s;
  });

  let localHooks = $state<unknown[]>([]);

  onDestroy(() => {
    unsubState();
    unsubSession();
  });

  $effect(() => {
    if (session?.draft) {
      localHooks = Array.isArray(session.draft) ? [...session.draft] : [];
    }
  });

  const hookDef = $derived({
    name: 'hooks',
    label: 'Hooks',
    type: 'hooks' as const,
    hookOptions: { taskOptions: state.hookTaskOptions || [] },
  } satisfies FormFieldDef);

  function handleBack(): void {
    const s = get(hooksEditorSession);
    if (!s) {
      activeEntity.set({ type: 'welcome' });
      return;
    }
    s.commit(localHooks);
    hooksEditorSession.set(null);
    activeEntity.set(s.returnTarget);
  }

  const backLabel = $derived(
    session?.returnTarget?.type === 'new-server' ? 'Add Server' : 'Server Configuration',
  );
</script>

{#if session}
  <div class="hooks-editor jsm-page-padding jsm-stack-lg">
    <BackControl label={backLabel} onBack={handleBack} />
    <header class="hooks-head">
      <h1 class="jsm-type-page-title">Hooks</h1>
      <p class="jsm-type-meta">Configure terminal commands or VS Code tasks for lifecycle events</p>
    </header>

    <HookList
      def={hookDef}
      value={localHooks as import('@core/types').HookConfig[]}
      onChange={(v) => (localHooks = v)}
      id="hooks-editor-list"
    />
  </div>
{:else}
  <div class="hooks-editor jsm-page-padding">
    <p class="jsm-type-meta">No hooks session</p>
  </div>
{/if}

<style>
  .hooks-editor {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .hooks-head {
    margin-bottom: var(--jsm-space-md);
  }
</style>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import type { FormFieldDef } from '../../../protocol';
  import { sendExecuteCommand } from '../../bridge';
  import { hooksEditorSession, activeEntity, spaState, lastCommandResult } from '../../stores';
  import type { HookConfig } from '@core/types';
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
  let pendingHookTest = $state<{ requestId: string; index: number } | null>(null);
  let hookTestState = $state<{ index: number; status: 'running' | 'succeeded' | 'failed'; message?: string } | null>(null);

  const unsubCommandResult = lastCommandResult.subscribe(result => {
    if (!result || !pendingHookTest || result.requestId !== pendingHookTest.requestId) {
      return;
    }

    hookTestState = {
      index: pendingHookTest.index,
      status: result.ok ? 'succeeded' : 'failed',
      message: result.message ?? (result.ok ? 'Hook completed.' : 'Hook failed.'),
    };
    pendingHookTest = null;
  });

  onDestroy(() => {
    unsubState();
    unsubSession();
    unsubCommandResult();
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
    hookOptions: { 
      taskOptions: state.hookTaskOptions || [],
      events: session?.eventOptions,
    },
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

  function getHookTestTarget():
    | { serverId: string; serverKey?: string; workspaceFolderUri: string; targetDeploymentId?: string }
    | undefined {
    const target = session?.returnTarget;
    if (!target) {
      return undefined;
    }

    if (target.type === 'server') {
      const serverId = target.serverId ?? target.id;
      if (!serverId || !target.workspaceFolderUri) {
        return undefined;
      }
      return {
        serverId,
        serverKey: target.serverKey ?? target.id,
        workspaceFolderUri: target.workspaceFolderUri,
      };
    }

    if (target.type === 'deployment') {
      if (!target.serverId || !target.workspaceFolderUri) {
        return undefined;
      }
      return {
        serverId: target.serverId,
        serverKey: target.serverKey,
        workspaceFolderUri: target.workspaceFolderUri,
        ...(target.id ? { targetDeploymentId: target.id } : {}),
      };
    }

    return undefined;
  }

  function handleTestHook(hook: HookConfig, index: number): void {
    const target = getHookTestTarget();
    if (!target) {
      hookTestState = {
        index,
        status: 'failed',
        message: 'Save this server or deployment before testing hooks.',
      };
      return;
    }

    const requestId = crypto.randomUUID();
    pendingHookTest = { requestId, index };
    hookTestState = { index, status: 'running' };
    lastCommandResult.set(null);
    sendExecuteCommand('jsm.hook.test', [{
      ...target,
      hook,
    }], requestId);
  }

  const backLabel = $derived.by(() => {
    const t = session?.returnTarget?.type;
    if (t === 'new-server') {
      return 'Add Server';
    }
    if (t === 'new-template') {
      return 'Create Template';
    }
    if (t === 'edit-template') {
      return 'Edit Template';
    }
    if (t === 'server') {
      return 'Server Configuration';
    }
    return 'Back';
  });
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
      onTest={getHookTestTarget() ? handleTestHook : undefined}
      testState={hookTestState}
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

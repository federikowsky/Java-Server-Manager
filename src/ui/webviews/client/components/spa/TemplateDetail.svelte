<script lang="ts">
  import { onDestroy } from 'svelte';
  import { activeEntity, formId, spaState, submitting } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import FormBody from '../FormBody.svelte';
  import FormActions from '../FormActions.svelte';
  import Icon from '../Icon.svelte';
  import FormPage from './FormPage.svelte';

  const { templateId }: { templateId?: string } = $props();

  let state = $state($spaState);
  const unsubscribeSpaState = spaState.subscribe(s => { state = s; });

  let tpl = $derived(templateId ? state.templates.find(t => t.template.id === templateId) : undefined);
  let isFormReady = $derived(
    !!state.currentFormSchema
    && state.currentFormId === 'jsm.templateForm'
    && (templateId ? state.currentFormTargetId === templateId : !state.currentFormTargetId)
  );

  let requestedKey = $state('');
  let formLoadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let formLoadMessage = $state('');
  let formLoadTimer: ReturnType<typeof setTimeout> | undefined;

  function clearFormTimer(): void {
    if (formLoadTimer) {
      clearTimeout(formLoadTimer);
      formLoadTimer = undefined;
    }
  }

  function requestTemplateForm(force = false): void {
    const nextKey = templateId ? `edit:${templateId}` : 'create';
    if (!force && requestedKey === nextKey && (formLoadState === 'loading' || formLoadState === 'ready' || isFormReady)) {
      return;
    }

    formLoadState = 'loading';
    formLoadMessage = '';
    requestedKey = nextKey;
    clearFormTimer();
    formLoadTimer = setTimeout(() => {
      if (!isFormReady) {
        formLoadState = 'error';
        formLoadMessage = 'The template form did not load. Retry the request.';
      }
    }, 1500);

    if (templateId) {
      postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'executeCommand', id: 'jsm.internal.requestTemplateSchema', args: ['edit', templateId] });
      return;
    }

    postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'executeCommand', id: 'jsm.internal.requestTemplateSchema', args: ['create'] });
  }

  onDestroy(() => {
    unsubscribeSpaState();
    clearFormTimer();
  });

  $effect(() => {
    const nextKey = templateId ? `edit:${templateId}` : 'create';

    if (requestedKey !== nextKey) {
      requestedKey = '';
      formLoadState = 'idle';
      formLoadMessage = '';
      clearFormTimer();
    }

    if (templateId && !tpl) {
      return;
    }

    if (isFormReady || formLoadState === 'loading' || formLoadState === 'error') {
      return;
    }

    requestTemplateForm();
  });

  $effect(() => {
    if (isFormReady) {
      clearFormTimer();
      formLoadState = 'ready';
      formLoadMessage = '';
    }
  });

  function handleDelete() {
    postToHost({ 
      v: WEBVIEW_PROTOCOL_VERSION, 
      command: 'executeCommand', 
      id: 'jsm.template.delete', 
      args: [templateId] 
    });
  }

  function handleCreateServer() {
    if (!templateId) return;
    activeEntity.set({ type: 'new-server', templateId });
  }
</script>

{#if tpl}
  <FormPage
    icon="file-code"
    eyebrow="Template"
    title={tpl.template.name}
    subtitle={tpl.template.description || 'Reusable defaults for provisioning new servers from the dashboard.'}
  >
    <svelte:fragment slot="actions">
      <span class="badge scope">{tpl.scope}</span>
      <button type="button" class="action-btn primary" onclick={handleCreateServer}>
        <Icon name="play" size={14} />
        <span>Create Server</span>
      </button>
      <button type="button" class="action-btn danger" onclick={handleDelete}>
        <Icon name="trash" size={14} />
        <span>Delete</span>
      </button>
    </svelte:fragment>

    {#if isFormReady}
      <div class="form-surface">
        <FormBody sections={$spaState.currentFormSchema?.sections || []} />
      </div>
    {:else if formLoadState === 'error'}
      <div class="inline-loading-state error">
        <Icon name="error" size={20} />
        <div class="inline-loading-copy">
          <span>{formLoadMessage}</span>
          <button type="button" class="action-btn" onclick={() => requestTemplateForm(true)}>
            <Icon name="refresh" size={14} />
            <span>Retry</span>
          </button>
        </div>
      </div>
    {:else}
      <div class="inline-loading-state">
        <Icon name="loading" size={20} />
        <span>Loading template form…</span>
      </div>
    {/if}

    <svelte:fragment slot="footer">
      {#if isFormReady}
        <FormActions
          mode="edit"
          submitting={$submitting}
          formId={$formId}
          submitLabel="Save Template"
          showCancel={false}
        />
      {/if}
    </svelte:fragment>
  </FormPage>
{:else if !templateId}
  <FormPage
    icon="file-code"
    eyebrow="New Template"
    title="Create Template"
    subtitle="Capture server defaults once, then reuse them from the dashboard when adding new managed instances."
  >
    {#if isFormReady}
      <div class="form-surface">
        <FormBody sections={$spaState.currentFormSchema?.sections || []} />
      </div>
    {:else if formLoadState === 'error'}
      <div class="inline-loading-state error">
        <Icon name="error" size={20} />
        <div class="inline-loading-copy">
          <span>{formLoadMessage}</span>
          <button type="button" class="action-btn" onclick={() => requestTemplateForm(true)}>
            <Icon name="refresh" size={14} />
            <span>Retry</span>
          </button>
        </div>
      </div>
    {:else}
      <div class="inline-loading-state">
        <Icon name="loading" size={20} />
        <span>Loading template form…</span>
      </div>
    {/if}

    <svelte:fragment slot="footer">
      {#if isFormReady}
        <FormActions
          mode="create"
          submitting={$submitting}
          formId={$formId}
          submitLabel="Create Template"
          showCancel={false}
        />
      {/if}
    </svelte:fragment>
  </FormPage>
{:else}
  <div class="empty-state">
    <Icon name="file-code" size={48} />
    <h3>Template not found</h3>
    <p>The requested template could not be loaded.</p>
  </div>
{/if}

<style>
  .action-btn {
    background: var(--jsm-color-secondary);
    color: var(--jsm-color-secondary-fg);
    border: 1px solid var(--jsm-color-border-secondary);
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    border-radius: var(--jsm-radius-sm);
    cursor: pointer;
    font-size: var(--jsm-font-size-md);
    font-family: var(--jsm-font-family);
    display: flex;
    align-items: center;
    gap: var(--jsm-space-xs);
    transition: background-color var(--jsm-transition-fast);
  }
  .action-btn:hover {
    background: var(--jsm-color-secondary-hover);
  }
  .action-btn.primary {
    background: var(--jsm-color-primary);
    color: var(--jsm-color-primary-fg);
  }
  .action-btn.primary:hover {
    background: var(--jsm-color-primary-hover);
  }
  .action-btn.danger:hover {
    background: var(--jsm-color-error);
    color: white;
  }
  
  .badge {
    padding: var(--jsm-badge-padding-y) var(--jsm-badge-padding-x);
    border-radius: var(--jsm-badge-radius);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-semibold);
    text-transform: uppercase;
    background: var(--jsm-badge-bg);
    color: var(--jsm-badge-fg);
  }

  .form-surface {
    padding: var(--jsm-space-lg);
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-lg);
    background: var(--jsm-color-bg-secondary);
  }

  .inline-loading-state {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    color: var(--jsm-color-fg-secondary);
    padding: var(--jsm-space-lg);
    border: 1px dashed var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-md);
    background: var(--jsm-color-bg-secondary);
  }

  .inline-loading-state.error {
    color: var(--jsm-color-error);
    border-style: solid;
    background: color-mix(in srgb, var(--jsm-color-error) 8%, var(--jsm-color-bg-secondary));
  }

  .inline-loading-copy {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-md);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--jsm-space-md);
    height: 100%;
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-md);
  }
  .empty-state h3 {
    margin: 0;
    font-size: var(--jsm-font-size-xl);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }
  .empty-state p {
    margin: 0;
  }
</style>

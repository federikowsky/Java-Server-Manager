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
  const unsubscribeSpaState = spaState.subscribe(s => {
    state = s;
  });

  let isEdit = $derived(!!templateId);
  let tpl = $derived(templateId ? state.templates.find(t => t.template.id === templateId) : undefined);

  let isFormReady = $derived(
    !!state.currentFormSchema
    && state.currentFormId === 'jsm.templateForm'
    && (templateId ? state.currentFormTargetId === templateId : !state.currentFormTargetId),
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
      postToHost({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'executeCommand',
        id: 'jsm.internal.requestTemplateSchema',
        args: ['edit', templateId],
      });
      return;
    }

    postToHost({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'executeCommand',
      id: 'jsm.internal.requestTemplateSchema',
      args: ['create'],
    });
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

  function goBack(): void {
    activeEntity.set({ type: 'templates-index' });
  }
</script>

{#if templateId && !tpl}
  <div class="tpl-editor jsm-page-padding">
    <FormPage
      backLabel="Templates"
      onBack={goBack}
      title="Template"
      subtitle="The requested template could not be loaded."
      variant="editor"
    >
      <p class="jsm-type-meta">Template not found</p>
    </FormPage>
  </div>
{:else}
  <FormPage
    backLabel="Templates"
    onBack={goBack}
    title={isEdit ? 'Edit Template' : 'Create Template'}
    subtitle={isEdit
      ? 'Update reusable defaults for provisioning managed instances.'
      : 'Save reusable defaults for provisioning managed instances.'}
    variant="editor"
  >
    <span slot="contextTags" class="tag-upper" class:tag-upper--hidden={!tpl}>
      {#if tpl}
        {String((tpl.template as { pluginType?: string }).pluginType ?? '').toUpperCase()}
      {/if}
    </span>

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

    <div slot="footer" class="tpl-editor-footer">
      {#if isFormReady}
        <FormActions
          mode={isEdit ? 'edit' : 'create'}
          submitting={$submitting}
          formId={$formId}
          submitLabel="Save Template"
          showCancel={false}
        />
      {/if}
    </div>
  </FormPage>
{/if}

<style>
  .tpl-editor {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .form-surface {
    padding: var(--jsm-space-lg);
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-sm);
    background: var(--jsm-surface-1);
  }
  .inline-loading-state {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    color: var(--jsm-color-fg-secondary);
    padding: var(--jsm-space-lg);
    border: 1px dashed var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-sm);
    background: var(--jsm-surface-1);
  }
  .inline-loading-state.error {
    color: var(--jsm-color-error);
    border-style: solid;
    background: color-mix(in srgb, var(--jsm-color-error) 8%, var(--jsm-surface-1));
  }
  .inline-loading-copy {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-md);
  }
  .action-btn {
    background: var(--jsm-color-secondary);
    color: var(--jsm-color-secondary-fg);
    border: 1px solid var(--jsm-color-border-secondary);
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    border-radius: var(--jsm-radius-sm);
    cursor: pointer;
    font-size: var(--jsm-font-size-md);
    font-family: var(--jsm-font-family);
    display: inline-flex;
    align-items: center;
    gap: var(--jsm-space-xs);
  }
  .tag-upper {
    display: inline-flex;
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--jsm-color-fg-secondary);
    border: 1px dashed var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-xs);
    padding: 2px var(--jsm-space-sm);
  }
  .tag-upper--hidden {
    display: none;
  }
</style>

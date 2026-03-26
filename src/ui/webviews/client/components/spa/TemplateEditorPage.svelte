<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { activeEntity, formData, formId, spaState, submitting } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import FormBody from '../FormBody.svelte';
  import FormActions from '../FormActions.svelte';
  import Icon from '../Icon.svelte';
  import FormPage from './FormPage.svelte';
  import ContextTag from '../ds/ContextTag.svelte';

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

  let templateEditBaselineKey = $state('');
  let templateEditBaseline = $state<Record<string, unknown> | null>(null);

  $effect(() => {
    if (!isEdit || !isFormReady || !templateId) {
      templateEditBaselineKey = '';
      templateEditBaseline = null;
      return;
    }
    const key = templateId;
    if (templateEditBaselineKey !== key) {
      templateEditBaselineKey = key;
      templateEditBaseline = JSON.parse(JSON.stringify(get(formData))) as Record<string, unknown>;
    }
  });

  function handleTemplateReset(): void {
    if (templateEditBaseline) {
      formData.set(JSON.parse(JSON.stringify(templateEditBaseline)) as Record<string, unknown>);
    }
  }

  let backLabel = $derived(
    isEdit && tpl
      ? String((tpl.template as { name?: string }).name ?? '').trim() || 'Templates'
      : 'Templates',
  );

  let pageSubtitle = $derived(
    isEdit
      ? 'Update provisioning defaults and template metadata.'
      : 'Save reusable defaults for provisioning managed instances.',
  );
</script>

{#if templateId && !tpl}
  <div class="tpl-editor jsm-page-padding">
    <FormPage
      backLabel={backLabel}
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
    backLabel={backLabel}
    onBack={goBack}
    title={isEdit ? 'Edit Template' : 'Create Template'}
    subtitle={pageSubtitle}
    variant="editor"
  >
    <svelte:fragment slot="actions">
      {#if tpl}
        <ContextTag text={String((tpl.template as { pluginType?: string }).pluginType ?? '').toUpperCase()} />
      {/if}
    </svelte:fragment>

    {#if isFormReady}
      <div class="tpl-form-stack">
        <FormBody sections={$spaState.currentFormSchema?.sections || []} layout="spa" />
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
        <span>Loading configuration…</span>
      </div>
    {/if}

    <div slot="footer" class="tpl-editor-footer">
      {#if isFormReady}
        <FormActions
          mode={isEdit ? 'edit' : 'create'}
          submitting={$submitting}
          formId={$formId}
          submitLabel={isEdit ? 'Save Changes' : 'Save Template'}
          showCancel={!isEdit}
          showReset={isEdit}
          onReset={handleTemplateReset}
        />
      {/if}
    </div>
  </FormPage>
{/if}

<style>
  @import './forms/wizardFormShared.css';

  .tpl-editor {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .tpl-form-stack {
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-lg);
    min-width: 0;
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
</style>

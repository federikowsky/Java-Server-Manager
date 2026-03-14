<script lang="ts">
  import { spaState } from '../../stores';
  import { postToHost } from '../../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../../protocol';
  import FormBody from '../FormBody.svelte';
  import FormActions from '../FormActions.svelte';
  import Icon from '../Icon.svelte';

  const { templateId }: { templateId?: string } = $props();

  let state = $state($spaState);
  spaState.subscribe(s => { state = s; });

  let tpl = $derived(templateId ? state.templates.find(t => t.template.id === templateId) : undefined);

  let schemaRequested = false;

  $effect(() => {
    if (schemaRequested) return;

    if (tpl) {
      postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'executeCommand', id: 'jsm.internal.requestTemplateSchema', args: ['edit', templateId] });
      schemaRequested = true;
      return;
    }

    // In create mode, request a schema for a new template.
    if (!templateId) {
      postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'executeCommand', id: 'jsm.internal.requestTemplateSchema', args: ['create'] });
      schemaRequested = true;
    }
  });

  function handleAction(cmd: string) {
    postToHost({ 
      v: WEBVIEW_PROTOCOL_VERSION, 
      command: 'executeCommand', 
      id: cmd, 
      args: [templateId] 
    });
  }
</script>

{#if tpl}
  <div class="template-detail">
    <div class="header">
      <div class="header-main">
        <h1>{tpl.template.name}</h1>
        <span class="badge scope">{tpl.scope}</span>
      </div>
      <div class="header-actions">
        <button class="action-btn primary" title="Create Server from Template" onclick={() => handleAction('jsm.template.createServer')}>
          <Icon name="play" size={14} />
          <span>Create Server</span>
        </button>
        <button class="action-btn danger" title="Delete Template" onclick={() => handleAction('jsm.template.delete')}>
          <Icon name="trash" size={14} />
          <span>Delete</span>
        </button>
      </div>
    </div>

    <div class="content">
      <FormBody sections={$spaState.currentFormSchema?.sections || []} />
      <FormActions mode="edit" submitting={false} formId="jsm.templateForm" />
    </div>
  </div>
{:else}
  <div class="empty-state">
    <Icon name="file-code" size={48} />
    <h3>Template not found</h3>
    <p>The requested template could not be loaded.</p>
  </div>
{/if}

<style>
  .template-detail {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .header {
    padding: var(--jsm-space-xl);
    border-bottom: 1px solid var(--jsm-color-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header-main {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-lg);
  }
  .header-main h1 {
    margin: 0;
    font-size: var(--jsm-font-size-2xl);
    font-weight: var(--jsm-font-weight-medium);
  }
  .header-actions {
    display: flex;
    gap: var(--jsm-space-sm);
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

  .content {
    padding: var(--jsm-space-xl);
    flex: 1;
    overflow-y: auto;
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
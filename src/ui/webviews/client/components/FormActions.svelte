<script lang="ts">
  import { get } from 'svelte/store';
  import { formData, submitting as submittingStore } from '../stores';
  import { sendSubmit, sendCancel, postToHost } from '../bridge';
  import { WEBVIEW_PROTOCOL_VERSION } from '../../protocol';

  const {
    mode,
    submitting,
    formId,
    submitLabel,
    showCancel = true,
    showReset = false,
    onReset,
    onCancel,
  }: {
    mode: 'create' | 'edit';
    submitting: boolean;
    formId: string;
    submitLabel?: string;
    showCancel?: boolean;
    showReset?: boolean;
    onReset?: () => void;
    onCancel?: () => void;
  } = $props();

  function getSubmitLabel(): string {
    if (submitLabel) return submitLabel;
    if (mode === 'edit') return 'Save Changes';
    if (formId.includes('deployment')) return 'Add Deployment';
    if (formId.includes('template')) return 'Create Template';
    return 'Create Server';
  }

  function handleSubmit(): void {
    let payload: Record<string, unknown>;
    try {
      const raw = get(formData);
      payload = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    } catch (e) {
      postToHost({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'traceLog',
        message: '[FormActions] submit: could not serialize form data',
        data: { error: String(e) },
      });
      return;
    }

    submittingStore.set(true);
    try {
      sendSubmit(payload);
    } catch (e) {
      submittingStore.set(false);
      postToHost({
        v: WEBVIEW_PROTOCOL_VERSION,
        command: 'traceLog',
        message: '[FormActions] submit: postMessage failed',
        data: { error: String(e) },
      });
    }
  }

  function handleCancel(): void {
    if (onCancel) {
      onCancel();
      return;
    }
    sendCancel();
  }

  function handleReset(): void {
    onReset?.();
  }
</script>

<!-- Spec §15.4: secondary actions first, then primary (e.g. [ Cancel ] < Save >). -->
<div class="button-bar">
  {#if showCancel}
    <button type="button" class="btn btn-secondary" onclick={handleCancel}>
      Cancel
    </button>
  {/if}
  {#if showReset}
    <button
      type="button"
      class="btn btn-secondary"
      onclick={handleReset}
      disabled={!onReset}
    >
      Reset
    </button>
  {/if}
  <button
    type="button"
    class="btn btn-primary"
    disabled={submitting}
    onclick={handleSubmit}
  >
    {#if submitting}
      <span class="btn-spinner" aria-hidden="true"></span>
      Saving…
    {:else}
      {getSubmitLabel()}
    {/if}
  </button>
</div>

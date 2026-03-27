<script lang="ts">
  import { formData, submitting as submittingStore } from '../stores';
  import { sendSubmit, sendCancel } from '../bridge';

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
    submittingStore.set(true);
    let data: Record<string, unknown> = {};
    formData.subscribe(d => { data = { ...d }; })();
    sendSubmit(data);
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

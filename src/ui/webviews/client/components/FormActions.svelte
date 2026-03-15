<script lang="ts">
  import { formData, submitting as submittingStore } from '../stores';
  import { sendSubmit, sendCancel } from '../bridge';

  const {
    mode,
    submitting,
    formId,
    submitLabel,
    showCancel,
    onCancel,
  }: {
    mode: 'create' | 'edit';
    submitting: boolean;
    formId: string;
    submitLabel?: string;
    showCancel?: boolean;
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
</script>

<div class="button-bar">
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
  {#if showCancel !== false}
    <button
      type="button"
      class="btn btn-secondary"
      onclick={handleCancel}
    >
      Cancel
    </button>
  {/if}
</div>

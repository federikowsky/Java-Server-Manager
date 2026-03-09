<script lang="ts">
  import { formData, submitting as submittingStore } from '../stores';
  import { sendSubmit, sendCancel } from '../bridge';

  const { mode, submitting, formId }: {
    mode: 'create' | 'edit';
    submitting: boolean;
    formId: string;
  } = $props();

  function getSubmitLabel(): string {
    if (mode === 'edit') return 'Save Changes';
    if (formId.includes('deployment')) return 'Add Deployment';
    return 'Create Server';
  }

  function handleSubmit(): void {
    submittingStore.set(true);
    let data: Record<string, unknown> = {};
    formData.subscribe(d => { data = { ...d }; })();
    sendSubmit(data);
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
  <button
    type="button"
    class="btn btn-secondary"
    onclick={() => sendCancel()}
  >
    Cancel
  </button>
</div>

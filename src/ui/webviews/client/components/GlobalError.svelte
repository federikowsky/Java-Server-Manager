<script lang="ts">
  import { globalError, hostError } from '../stores';

  const { message }: { message: string } = $props();

  function dismiss(): void {
    globalError.set('');
    hostError.set('');
  }
</script>

{#if message}
  <div class="global-error" role="alert" aria-live="assertive">
    <span class="global-error-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="none"/>
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
      </svg>
    </span>
    <span class="global-error-text">{message}</span>
    <button
      type="button"
      class="global-error-dismiss"
      aria-label="Dismiss error"
      onclick={dismiss}
    >×</button>
  </div>
{/if}

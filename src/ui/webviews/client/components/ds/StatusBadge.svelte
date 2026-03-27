<script lang="ts">
  /** Runtime-ish states; shown as (STOPPED) style per spec §14.3 */
  const { state }: { state: string } = $props();
  let normalized = $derived(state?.toLowerCase?.() ?? 'unknown');
</script>

<span class="jsm-status-badge" data-state={normalized}>({state})</span>

<style>
  .jsm-status-badge {
    display: inline-flex;
    align-items: center;
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-semibold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--jsm-color-fg-secondary);
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-xs);
    padding: 2px var(--jsm-space-sm);
    white-space: nowrap;
  }
  .jsm-status-badge[data-state='running'] {
    color: var(--jsm-status-running);
    border-color: color-mix(in srgb, var(--jsm-status-running) 35%, var(--jsm-color-border));
  }
  .jsm-status-badge[data-state='error'] {
    color: var(--jsm-status-error);
    border-color: color-mix(in srgb, var(--jsm-status-error) 35%, var(--jsm-color-border));
  }
  .jsm-status-badge[data-state='stopped'] {
    color: var(--jsm-color-fg-muted);
  }
</style>

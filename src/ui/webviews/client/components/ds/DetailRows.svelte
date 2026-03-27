<script lang="ts">
  const { rows }: { rows: { label: string; value: string }[] } = $props();
</script>

<dl class="jsm-detail-rows">
  {#each rows as r}
    <div class="jsm-detail-row">
      <dt class="jsm-detail-label">{r.label}</dt>
      <dd class="jsm-detail-value" title={r.value}>{r.value}</dd>
    </div>
  {/each}
</dl>

<style>
  .jsm-detail-rows {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-sm);
  }
  .jsm-detail-row {
    display: grid;
    grid-template-columns: minmax(8rem, 11rem) 1fr;
    gap: var(--jsm-space-md);
    align-items: baseline;
  }
  .jsm-detail-label {
    margin: 0;
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg-secondary);
  }
  .jsm-detail-value {
    margin: 0;
    font-size: var(--jsm-font-size-md);
    font-family: var(--jsm-font-family);
    color: var(--jsm-color-fg);
    word-break: break-word;
  }
</style>

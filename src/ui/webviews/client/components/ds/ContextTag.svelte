<script lang="ts">
  const { text }: { text: string } = $props();
</script>

<span class="jsm-ctx-tag">{text}</span>

<style>
  .jsm-ctx-tag {
    display: inline-flex;
    align-items: center;
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--jsm-color-fg-secondary);
    border: 1px dashed var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-xs);
    padding: 2px var(--jsm-space-sm);
  }
</style>

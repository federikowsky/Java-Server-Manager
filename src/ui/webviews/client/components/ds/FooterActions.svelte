<script lang="ts">
  /** Spec §15.4 — primary right-aligned */
</script>

<div class="jsm-footer-actions">
  <slot />
</div>

<style>
  .jsm-footer-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--jsm-space-sm);
    flex-shrink: 0;
    padding: var(--jsm-space-lg) 0 0;
    margin-top: auto;
    border-top: 1px solid var(--jsm-color-border-secondary);
  }
</style>

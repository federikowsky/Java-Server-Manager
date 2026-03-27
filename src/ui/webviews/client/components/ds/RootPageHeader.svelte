<script lang="ts">
  const {
    title,
    subtitle = '',
  }: {
    title: string;
    subtitle?: string;
  } = $props();
</script>

<header class="jsm-root-header">
  <div class="jsm-root-header-copy">
    <h1 class="jsm-type-page-title">{title}</h1>
    {#if subtitle}
      <p class="jsm-type-meta">{subtitle}</p>
    {/if}
  </div>
  <div class="jsm-root-header-actions">
    <slot name="actions" />
  </div>
</header>

<style>
  .jsm-root-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--jsm-space-lg);
    margin-bottom: var(--jsm-space-lg);
    flex-shrink: 0;
  }
  .jsm-root-header-copy {
    min-width: 0;
  }
  .jsm-root-header-actions {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    flex-shrink: 0;
  }
</style>

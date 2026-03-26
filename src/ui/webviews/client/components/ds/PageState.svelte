<script lang="ts">
  const {
    title,
    description = '',
    variant = 'empty',
  }: {
    title: string;
    description?: string;
    variant?: 'empty' | 'loading' | 'error';
  } = $props();
</script>

<div
  class="jsm-page-state jsm-surface-section"
  role="status"
  aria-live={variant === 'loading' ? 'polite' : undefined}
  data-variant={variant}
>
  <p class="jsm-page-state-title">{title}</p>
  {#if description}
    <p class="jsm-page-state-desc">{description}</p>
  {/if}
  <div class="jsm-page-state-actions">
    <slot name="actions" />
  </div>
</div>

<style>
  .jsm-page-state {
    padding: var(--jsm-space-xl);
    max-width: 48rem;
  }
  .jsm-page-state-title {
    margin: 0 0 var(--jsm-space-sm);
    font-size: var(--jsm-font-size-md);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
  }
  .jsm-page-state-desc {
    margin: 0 0 var(--jsm-space-lg);
    font-size: var(--jsm-font-size-sm);
    color: var(--jsm-color-fg-secondary);
    line-height: var(--jsm-line-height-relaxed);
  }
  .jsm-page-state-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--jsm-space-sm);
    align-items: center;
  }
  .jsm-page-state[data-variant='error'] .jsm-page-state-title {
    color: var(--jsm-color-error);
  }
</style>

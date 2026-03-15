<script lang="ts">
  import Icon from '../Icon.svelte';
  import type { IconName } from '../Icon.svelte';

  const {
    icon,
    title,
    subtitle = '',
    eyebrow = '',
    alignStart = false,
  }: {
    icon: IconName;
    title: string;
    subtitle?: string;
    eyebrow?: string;
    alignStart?: boolean;
  } = $props();
</script>

<div class="form-page">
  <div class="page-header" class:align-start={alignStart}>
    <div class="page-header-main">
      <div class="page-icon">
        <Icon name={icon} size={20} />
      </div>
      <div class="page-header-copy">
        {#if eyebrow}
          <p class="page-eyebrow">{eyebrow}</p>
        {/if}
        <h1>{title}</h1>
        {#if subtitle}
          <p class="page-subtitle">{subtitle}</p>
        {/if}
      </div>
    </div>
    <div class="page-header-actions">
      <slot name="actions" />
    </div>
  </div>

  <div class="page-body">
    <slot />
  </div>

  <div class="page-footer">
    <slot name="footer" />
  </div>
</div>

<style>
  .form-page {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--jsm-space-lg);
    padding: var(--jsm-space-xl);
    border-bottom: 1px solid var(--jsm-color-border);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--jsm-color-primary) 8%, transparent), transparent 55%),
      var(--jsm-color-bg);
  }

  .page-header.align-start {
    align-items: flex-start;
  }

  .page-header-main {
    display: flex;
    align-items: flex-start;
    gap: var(--jsm-space-md);
    min-width: 0;
  }

  .page-icon {
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--jsm-radius-md);
    background: color-mix(in srgb, var(--jsm-color-primary) 14%, var(--jsm-color-bg));
    color: var(--jsm-color-primary);
    border: 1px solid color-mix(in srgb, var(--jsm-color-primary) 18%, var(--jsm-color-border));
    flex-shrink: 0;
  }

  .page-header-copy {
    min-width: 0;
  }

  .page-eyebrow {
    margin: 0 0 var(--jsm-space-2xs);
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-xs);
    font-weight: var(--jsm-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .page-header-copy h1 {
    margin: 0;
    color: var(--jsm-color-fg);
    font-size: var(--jsm-font-size-2xl);
    font-weight: var(--jsm-font-weight-semibold);
  }

  .page-subtitle {
    margin: var(--jsm-space-2xs) 0 0;
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-sm);
    line-height: var(--jsm-line-height-relaxed);
  }

  .page-header-actions {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    flex-shrink: 0;
  }

  .page-body {
    flex: 1;
    padding: var(--jsm-space-xl);
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-lg);
    overflow-y: auto;
  }

  .page-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-lg) var(--jsm-space-xl);
    border-top: 1px solid var(--jsm-color-border);
    background: var(--jsm-color-bg-secondary);
  }

  .page-footer:empty {
    display: none;
  }
</style>

<script lang="ts">
  import Icon from '../Icon.svelte';
  import type { IconName } from '../Icon.svelte';
  import BackControl from '../ds/BackControl.svelte';

  const {
    title,
    subtitle = '',
    eyebrow = '',
    icon,
    alignStart = false,
    backLabel = '',
    onBack,
    variant = 'default',
  }: {
    title: string;
    subtitle?: string;
    eyebrow?: string;
    icon?: IconName;
    alignStart?: boolean;
    backLabel?: string;
    onBack?: () => void;
    variant?: 'default' | 'editor';
  } = $props();

  let showBack = $derived(Boolean(backLabel && onBack));
  let isEditor = $derived(variant === 'editor');
</script>

<div class="form-page" class:editor={isEditor}>
  {#if showBack && onBack}
    <div class="form-page-back jsm-page-padding">
      <BackControl label={backLabel} onBack={onBack} />
    </div>
  {/if}

  <div class="page-header" class:align-start={alignStart} class:editor={isEditor}>
    <div class="page-header-main">
      {#if !isEditor && icon}
        <div class="page-icon">
          <Icon name={icon} size={20} />
        </div>
      {/if}
      <div class="page-header-copy">
        {#if !isEditor && eyebrow}
          <p class="page-eyebrow">{eyebrow}</p>
        {/if}
        <h1 class="page-title">{title}</h1>
        {#if subtitle}
          <p class="page-subtitle">{subtitle}</p>
        {/if}
        <div class="page-context-tags">
          <slot name="contextTags" />
        </div>
      </div>
    </div>
    <div class="page-header-actions">
      <slot name="actions" />
    </div>
  </div>

  <div class="page-body" class:editor={isEditor}>
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
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .form-page.editor {
    background: var(--jsm-surface-0);
  }
  .form-page-back {
    padding-bottom: 0;
    flex-shrink: 0;
  }
  .form-page-back :global(.jsm-back) {
    margin-bottom: var(--jsm-space-sm);
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--jsm-space-lg);
    padding: var(--jsm-space-md) var(--jsm-space-xl);
    border-bottom: 1px solid var(--jsm-color-border-secondary);
    background: var(--jsm-surface-0);
    flex-shrink: 0;
  }
  .page-header.editor {
    align-items: flex-start;
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
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--jsm-radius-sm);
    background: var(--jsm-surface-1);
    color: var(--jsm-color-fg-secondary);
    border: 1px solid var(--jsm-color-border-secondary);
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
    letter-spacing: 0.06em;
  }

  .page-title {
    margin: 0;
    color: var(--jsm-color-fg);
    font-size: var(--jsm-font-size-xl);
    font-weight: var(--jsm-font-weight-semibold);
    line-height: var(--jsm-line-height-tight);
  }

  .page-subtitle {
    margin: var(--jsm-space-2xs) 0 0;
    color: var(--jsm-color-fg-secondary);
    font-size: var(--jsm-font-size-sm);
    line-height: var(--jsm-line-height-relaxed);
  }

  .page-context-tags {
    margin-top: var(--jsm-space-sm);
    display: flex;
    flex-wrap: wrap;
    gap: var(--jsm-space-sm);
    justify-content: flex-end;
  }
  .page-context-tags:empty {
    display: none;
  }

  .page-header.editor .page-header-main {
    flex: 1;
  }

  .page-header.editor .page-context-tags {
    justify-content: flex-end;
  }

  .page-header-actions {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    flex-shrink: 0;
  }

  .page-body {
    flex: 1;
    min-height: 0;
    padding: var(--jsm-space-lg) var(--jsm-space-xl);
    display: flex;
    flex-direction: column;
    gap: var(--jsm-space-lg);
    overflow-y: auto;
  }
  .page-body.editor {
    padding-top: var(--jsm-space-md);
  }

  .page-footer {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-lg) var(--jsm-space-xl);
    border-top: 1px solid var(--jsm-color-border-secondary);
    background: var(--jsm-surface-0);
  }

  .page-footer:empty {
    display: none;
  }
</style>

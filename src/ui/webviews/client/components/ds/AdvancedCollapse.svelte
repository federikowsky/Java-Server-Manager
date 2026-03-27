<script lang="ts">
  import Icon from '../Icon.svelte';

  const { title, defaultOpen = false }: { title: string; defaultOpen?: boolean } = $props();
  let open = $state(defaultOpen);
  const tid = `adv-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="jsm-adv jsm-surface-section">
  <button
    type="button"
    class="jsm-adv-toggle"
    aria-expanded={open}
    aria-controls={tid}
    onclick={() => (open = !open)}
  >
    <span class="jsm-adv-chevron" class:expanded={open} aria-hidden="true">
      <Icon name="chevron-right" size={16} />
    </span>
    {title}
  </button>
  {#if open}
    <div class="jsm-adv-divider" role="presentation"></div>
    <div id={tid} class="jsm-adv-body">
      <slot />
    </div>
  {/if}
</div>

<style>
  .jsm-adv {
    min-width: 0;
  }
  .jsm-adv-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    padding: var(--jsm-space-md) var(--jsm-space-lg);
    margin: 0;
    border: none;
    background: transparent;
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    font-weight: var(--jsm-font-weight-semibold);
    color: var(--jsm-color-fg);
    cursor: pointer;
    text-align: left;
  }
  .jsm-adv-toggle:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: -2px;
  }
  .jsm-adv-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--jsm-color-fg-secondary);
    transition: transform var(--jsm-transition-slower);
  }
  .jsm-adv-chevron.expanded {
    transform: rotate(90deg);
  }
  .jsm-adv-divider {
    height: 1px;
    background: var(--jsm-color-border-secondary);
  }
  .jsm-adv-body {
    padding: var(--jsm-space-md) var(--jsm-space-lg) var(--jsm-space-lg);
  }
</style>

<script lang="ts">
  import Icon from '../../Icon.svelte';

  interface Props {
    title: string;
    icon?: string;
    expanded?: boolean;
    completed?: boolean;
    disabled?: boolean;
    onToggle?: () => void;
    children?: any;
  }

  let { 
    title, 
    icon, 
    expanded = false, 
    completed = false,
    disabled = false,
    onToggle,
    children 
  }: Props = $props();

  function handleToggle() {
    if (disabled) return;
    onToggle?.();
  }
</script>

<div class="accordion-section" class:expanded class:completed class:disabled>
  <button 
    class="accordion-header" 
    onclick={handleToggle}
    aria-expanded={expanded}
    {disabled}
  >
    <span class="accordion-status">
      {#if completed}
        <Icon name="check" size={14} />
      {:else if expanded}
        <Icon name="chevron-down" size={14} />
      {:else}
        <Icon name="chevron-right" size={14} />
      {/if}
    </span>
    {#if icon}
      <Icon name={icon} size={16} />
    {/if}
    <span class="accordion-title">{title}</span>
  </button>
  
  {#if expanded}
    <div class="accordion-content">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .accordion-section {
    border: 1px solid var(--jsm-color-border-secondary);
    border-radius: var(--jsm-radius-lg);
    background: var(--jsm-color-bg-secondary);
    overflow: hidden;
    transition: border-color var(--jsm-transition-normal);
  }

  .accordion-section:not(:last-child) {
    margin-bottom: var(--jsm-space-md);
  }

  .accordion-section.expanded {
    border-color: var(--jsm-color-border-focus);
  }

  .accordion-section.completed {
    border-color: var(--jsm-status-running);
  }

  .accordion-section.disabled {
    opacity: 0.5;
  }

  .accordion-header {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    width: 100%;
    padding: var(--jsm-space-md) var(--jsm-space-lg);
    background: none;
    border: none;
    color: var(--jsm-color-fg);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-lg);
    font-weight: var(--jsm-font-weight-semibold);
    cursor: pointer;
    text-align: left;
    transition: background-color var(--jsm-transition-fast);
  }

  .accordion-header:hover:not(:disabled) {
    background: var(--jsm-color-bg-hover);
  }

  .accordion-header:disabled {
    cursor: not-allowed;
  }

  .accordion-status {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--jsm-color-fg-secondary);
    transition: transform var(--jsm-transition-normal);
  }

  .completed .accordion-status {
    color: var(--jsm-status-running);
  }

  .accordion-title {
    flex: 1;
  }

  .accordion-content {
    padding: var(--jsm-space-lg);
    padding-top: 0;
    animation: jsm-slide-down var(--jsm-transition-slow) ease-out;
  }
</style>

<script lang="ts">
  import Icon from '../Icon.svelte';
  import type { IconName } from '../Icon.svelte';

  export type DsOverflowMenuItem = {
    id: string;
    label: string;
    icon?: IconName;
    danger?: boolean;
    disabled?: boolean;
    onSelect: () => void;
  };

  const {
    ariaLabel = 'More actions',
    items,
  }: {
    ariaLabel?: string;
    items: DsOverflowMenuItem[];
  } = $props();

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | undefined>(undefined);
  const triggerId = `jsm-overflow-${Math.random().toString(36).slice(2, 9)}`;

  function close(): void {
    open = false;
  }

  function toggle(e: MouseEvent): void {
    e.stopPropagation();
    open = !open;
  }

  function onDocPointerDown(e: PointerEvent): void {
    if (!open || !rootEl) {
      return;
    }
    if (!rootEl.contains(e.target as Node)) {
      close();
    }
  }

  function onWindowKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      close();
    }
  }

  $effect(() => {
    if (!open) {
      return;
    }
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="ds-overflow" bind:this={rootEl}>
  <button
    type="button"
    class="ds-overflow-trigger"
    aria-label={ariaLabel}
    aria-expanded={open}
    aria-haspopup="menu"
    id={triggerId}
    onclick={toggle}
  >
    <Icon name="more" size={16} />
  </button>
  {#if open}
    <div class="ds-overflow-panel jsm-surface-section" role="menu" aria-labelledby={triggerId}>
      {#each items as item (item.id)}
        <button
          type="button"
          role="menuitem"
          class="ds-overflow-item"
          class:ds-overflow-item--danger={item.danger}
          disabled={item.disabled}
          onclick={() => {
            if (!item.disabled) {
              item.onSelect();
              close();
            }
          }}
        >
          {#if item.icon}
            <span class="ds-overflow-item-icon" aria-hidden="true">
              <Icon name={item.icon} size={14} />
            </span>
          {/if}
          <span class="ds-overflow-item-label">{item.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ds-overflow {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    vertical-align: middle;
  }

  .ds-overflow-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: var(--jsm-radius-xs);
    background: transparent;
    color: var(--jsm-color-fg-secondary);
    cursor: pointer;
  }

  .ds-overflow-trigger:hover {
    background: var(--jsm-color-bg-hover);
    color: var(--jsm-color-fg);
  }

  .ds-overflow-trigger:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  .ds-overflow-panel {
    position: absolute;
    right: 0;
    top: calc(100% + 2px);
    z-index: 1000;
    min-width: 11rem;
    padding: var(--jsm-space-2xs);
    display: flex;
    flex-direction: column;
    gap: 1px;
    box-shadow: var(--jsm-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.18));
  }

  .ds-overflow-item {
    display: flex;
    align-items: center;
    gap: var(--jsm-space-sm);
    width: 100%;
    margin: 0;
    padding: var(--jsm-space-sm) var(--jsm-space-md);
    border: none;
    border-radius: var(--jsm-radius-xs);
    background: transparent;
    color: var(--jsm-color-fg);
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-sm);
    text-align: left;
    cursor: pointer;
  }

  .ds-overflow-item:hover:not(:disabled) {
    background: var(--jsm-color-bg-hover);
  }

  .ds-overflow-item:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: -2px;
  }

  .ds-overflow-item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ds-overflow-item--danger:not(:disabled) {
    color: var(--jsm-color-error);
  }

  .ds-overflow-item--danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--jsm-color-error) 12%, var(--jsm-surface-1));
  }

  .ds-overflow-item-icon {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--jsm-color-fg-secondary);
  }

  .ds-overflow-item--danger:not(:disabled) .ds-overflow-item-icon {
    color: var(--jsm-color-error);
  }

  .ds-overflow-item-label {
    flex: 1;
    min-width: 0;
  }
</style>

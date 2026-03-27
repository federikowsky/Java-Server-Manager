<script lang="ts">
  const {
    tabs,
    active,
    onChange,
    ariaLabel,
  }: {
    tabs: { id: string; label: string }[];
    active: string;
    onChange: (id: string) => void;
    ariaLabel: string;
  } = $props();
</script>

<div class="jsm-entity-tabs" role="tablist" aria-label={ariaLabel}>
  {#each tabs as t}
    <button
      type="button"
      role="tab"
      class="jsm-entity-tab"
      class:active={active === t.id}
      aria-selected={active === t.id}
      onclick={() => onChange(t.id)}
    >
      {t.label}
    </button>
  {/each}
</div>

<style>
  .jsm-entity-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    border-bottom: 1px solid var(--jsm-color-border-secondary);
    flex-shrink: 0;
  }
  .jsm-entity-tab {
    position: relative;
    padding: var(--jsm-space-sm) var(--jsm-space-lg);
    margin-bottom: -1px;
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--jsm-color-fg-secondary);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    border-radius: var(--jsm-radius-xs) var(--jsm-radius-xs) 0 0;
  }
  .jsm-entity-tab:hover {
    color: var(--jsm-color-fg);
    background: color-mix(in srgb, var(--jsm-color-bg-hover) 50%, transparent);
  }
  .jsm-entity-tab.active {
    color: var(--jsm-color-fg);
    font-weight: var(--jsm-font-weight-semibold);
    border-bottom-color: var(--vscode-focusBorder);
  }
  .jsm-entity-tab:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: -2px;
  }
</style>

<script lang="ts">
  const {
    options,
    value,
    onChange,
    ariaLabel,
    disabledValues = [],
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    ariaLabel: string;
    disabledValues?: string[];
  } = $props();
</script>

<div class="jsm-mode-select" role="group" aria-label={ariaLabel}>
  {#each options as opt}
    <button
      type="button"
      class="jsm-mode-opt"
      class:selected={value === opt.value}
      aria-pressed={value === opt.value}
      disabled={disabledValues.includes(opt.value)}
      onclick={() => {
        if (!disabledValues.includes(opt.value)) onChange(opt.value);
      }}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .jsm-mode-select {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--jsm-space-sm);
  }
  .jsm-mode-opt {
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-sm);
    font-weight: var(--jsm-font-weight-medium);
    padding: var(--jsm-space-xs) var(--jsm-space-md);
    border-radius: var(--jsm-radius-sm);
    border: 1px solid var(--jsm-color-border-secondary);
    background: var(--jsm-surface-0);
    color: var(--jsm-color-fg-secondary);
    cursor: pointer;
  }
  .jsm-mode-opt:hover {
    background: var(--jsm-color-bg-hover);
    color: var(--jsm-color-fg);
  }
  .jsm-mode-opt.selected {
    border-color: var(--jsm-color-border);
    background: var(--jsm-surface-1);
    color: var(--jsm-color-fg);
    font-weight: var(--jsm-font-weight-semibold);
  }
  .jsm-mode-opt:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
  .jsm-mode-opt:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>

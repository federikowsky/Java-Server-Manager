<script lang="ts">
  const {
    label,
    onBack,
  }: {
    /** e.g. "Templates", "Server Configuration" (spec §8) */
    label: string;
    onBack: () => void;
  } = $props();
</script>

<button
  type="button"
  class="jsm-back"
  onclick={() => onBack()}
  aria-label={`Back to ${label}`}
>
  ← {label}
</button>

<style>
  .jsm-back {
    align-self: flex-start;
    margin: 0 0 var(--jsm-space-md);
    padding: 0;
    border: none;
    background: none;
    font-family: var(--jsm-font-family);
    font-size: var(--jsm-font-size-md);
    font-weight: var(--jsm-font-weight-medium);
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-align: left;
  }
  .jsm-back:hover {
    text-decoration: underline;
  }
  .jsm-back:focus-visible {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }
</style>

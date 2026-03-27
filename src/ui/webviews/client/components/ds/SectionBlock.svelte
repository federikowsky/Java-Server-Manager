<script lang="ts">
  const { title }: { title: string } = $props();
  let sid = $derived(
    `jsm-sec-${title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'section'}`,
  );
</script>

<section class="jsm-section jsm-surface-section" aria-labelledby={sid}>
  <div class="jsm-section-head">
    <h2 id={sid} class="jsm-type-section-title">{title}</h2>
  </div>
  <div class="jsm-section-divider" role="presentation"></div>
  <div class="jsm-section-body">
    <slot />
  </div>
</section>

<style>
  .jsm-section {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .jsm-section-head {
    padding: var(--jsm-space-md) var(--jsm-space-lg);
  }
  .jsm-section-divider {
    height: 1px;
    background: var(--jsm-color-border-secondary);
    margin: 0;
  }
  .jsm-section-body {
    padding: var(--jsm-space-md) var(--jsm-space-lg) var(--jsm-space-lg);
  }
</style>

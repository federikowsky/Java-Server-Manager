<script lang="ts">
  const { title, formId = '' }: { title: string; formId?: string } = $props();

  const isDeployment = $derived(formId.includes('deployment'));
</script>

<div class="form-header">
  <div class="form-header-icon">
    {#if isDeployment}
      <!-- Deploy/rocket icon -->
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
      </svg>
    {:else}
      <!-- Server icon -->
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
        <line x1="6" y1="6" x2="6.01" y2="6"/>
        <line x1="6" y1="18" x2="6.01" y2="18"/>
      </svg>
    {/if}
  </div>
  <div class="form-header-text">
    <h1 class="form-title">{title}</h1>
    <span class="form-subtitle">
      {#if isDeployment}
        Configure deployment target and options
      {:else}
        Configure server runtime, ports, and environment
      {/if}
    </span>
  </div>
</div>

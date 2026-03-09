<script lang="ts">
  import type { FormSection } from '../../protocol';
  import FormField from './FormField.svelte';

  const { section }: { section: FormSection } = $props();

  let collapsed = $state(section.collapsible === true);

  function toggle(): void {
    collapsed = !collapsed;
  }
</script>

<fieldset class="form-section" id="section-{section.id}">
  {#if section.title}
    {#if section.collapsible}
      <div
        class="section-header collapsible"
        role="button"
        tabindex="0"
        aria-expanded={!collapsed}
        aria-controls="section-{section.id}-content"
        onclick={toggle}
        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        <span class="section-chevron" class:collapsed>
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7 5.3 5.4z"/>
          </svg>
        </span>
        <span class="section-title">{section.title}</span>
      </div>
    {:else}
      <div class="section-header">
        <span class="section-title">{section.title}</span>
      </div>
    {/if}
  {/if}
  <div
    id="section-{section.id}-content"
    class="section-content"
    class:collapsed
  >
    {#each section.fields as field (field.name)}
      <FormField def={field} />
    {/each}
  </div>
</fieldset>

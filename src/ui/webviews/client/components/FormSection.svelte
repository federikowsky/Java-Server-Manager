<script lang="ts">
  import type { FormSection } from '../../protocol';
  import FormField from './FormField.svelte';
  import Icon from './Icon.svelte';

  const { section, spa = false }: { section: FormSection; spa?: boolean } = $props();

  let collapsed = $state(section.collapsible === true);

  function toggle(): void {
    collapsed = !collapsed;
  }
</script>

<fieldset class="form-section" class:form-section--spa={spa} id="section-{section.id}">
  {#if section.title}
    {#if section.collapsible}
      <div
        class="section-header collapsible"
        class:section-header--spa={spa}
        role="button"
        tabindex="0"
        aria-expanded={!collapsed}
        aria-controls="section-{section.id}-content"
        onclick={toggle}
        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        <span class="section-chevron-icon" class:expanded={!collapsed} aria-hidden="true">
          <Icon name="chevron-right" size={16} />
        </span>
        <span class="section-title" class:section-title--spa={spa}>{section.title}</span>
      </div>
    {:else}
      <div class="section-header" class:section-header--spa={spa}>
        <span class="section-title" class:section-title--spa={spa}>{section.title}</span>
      </div>
    {/if}
  {/if}
  <div
    id="section-{section.id}-content"
    class="section-content"
    class:section-content--spa={spa}
    class:collapsed
  >
    {#each section.fields as field (field.name)}
      <FormField def={field} />
    {/each}
  </div>
</fieldset>

<style>
  .section-chevron-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--jsm-color-fg-secondary);
    transition: transform var(--jsm-transition-slower);
  }
  .section-chevron-icon.expanded {
    transform: rotate(90deg);
  }
</style>

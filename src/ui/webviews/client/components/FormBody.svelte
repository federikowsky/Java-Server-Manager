<script lang="ts">
  import type { FormSection } from '../../protocol';
  import FormSectionComponent from './FormSection.svelte';

  const {
    sections,
    layout = 'legacy',
  }: {
    sections: FormSection[];
    /** `spa`: Section surfaces + spacing aligned with Server/Deployment wizards. */
    layout?: 'legacy' | 'spa';
  } = $props();
</script>

<form
  class="jsm-form"
  class:jsm-form--spa={layout === 'spa'}
  onsubmit={(e: Event) => e.preventDefault()}
>
  {#each sections as section (section.id)}
    <FormSectionComponent {section} spa={layout === 'spa'} />
  {/each}
</form>

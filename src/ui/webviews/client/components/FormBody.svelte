<script lang="ts">
  import type { FormSection } from '../../protocol';
  import FormSectionComponent from './FormSection.svelte';

  const { sections }: { sections: FormSection[] } = $props();
</script>

<form class="jsm-form" onsubmit={(e: Event) => e.preventDefault()}>
  {#each sections as section (section.id)}
    <FormSectionComponent {section} />
  {/each}
</form>

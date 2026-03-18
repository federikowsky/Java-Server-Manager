<script lang="ts">
  import type { FormSection } from '../../protocol';
  import { mode, templates, formData, formId } from '../stores';
  import FormSectionComponent from './FormSection.svelte';

  const { sections }: { sections: FormSection[] } = $props();

  let currentMode = $state<'create' | 'edit'>('create');
  let currentFormId = $state('');
  let currentTemplates = $state<Array<{ id: string; name: string; defaults: Record<string, unknown> }>>([]);
  let selectedTemplateId = $state('');

  mode.subscribe(m => { currentMode = m; });
  formId.subscribe(id => { currentFormId = id; });
  templates.subscribe(t => { currentTemplates = t; });

  function handleTemplateChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    selectedTemplateId = select.value;
    if (!selectedTemplateId) return;

    const template = currentTemplates.find(t => t.id === selectedTemplateId);
    if (template) {
      formData.update(d => ({ ...d, ...template.defaults }));
    }
  }
</script>

<form class="jsm-form" onsubmit={(e: Event) => e.preventDefault()}>
  {#if currentMode === 'create' && currentFormId === 'jsm.serverForm' && currentTemplates.length > 0}
    <div class="form-section template-selector">
      <div class="section-header">
        <h3 class="section-title">Starting Point</h3>
      </div>
      <div class="section-content">
        <div class="form-field">
          <label class="field-label" for="template-select">Use a Template</label>
          <select id="template-select" class="field-input" onchange={handleTemplateChange} value={selectedTemplateId}>
            <option value="">[ Blank Server ]</option>
            <optgroup label="Available Templates">
              {#each currentTemplates as template}
                <option value={template.id}>{template.name}</option>
              {/each}
            </optgroup>
          </select>
          <span class="field-help">Applying a template will fill the form below with predefined values.</span>
        </div>
      </div>
    </div>
  {/if}

  {#each sections as section (section.id)}
    <FormSectionComponent {section} />
  {/each}
</form>

<style>
  .template-selector {
    background: var(--vscode-editor-inactiveSelectionBackground);
    border: 1px dashed var(--vscode-panel-border);
  }
</style>

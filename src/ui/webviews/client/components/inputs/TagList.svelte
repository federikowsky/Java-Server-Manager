<script lang="ts">
  import type { FormFieldDef } from '../../../protocol';

  const { def, value, onChange, id }: {
    def: FormFieldDef;
    value: string[] | undefined;
    onChange: (v: string[]) => void;
    id: string;
  } = $props();

  let tags = $state<string[]>(value ? [...value] : []);
  let inputText = $state('');

  function addTag(): void {
    const val = inputText.trim();
    if (val.length === 0 || tags.includes(val)) return;
    tags = [...tags, val];
    inputText = '';
    onChange(tags);
  }

  function removeTag(index: number): void {
    tags = tags.filter((_, i) => i !== index);
    onChange(tags);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
    if (e.key === 'Backspace' && inputText === '' && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  }
</script>

<div class="tag-container" role="list" data-field={def.name}>
  {#each tags as tag, i (tag + '-' + i)}
    <span class="tag" role="listitem">
      {tag}
      <button
        type="button"
        class="tag-remove"
        aria-label="Remove {tag}"
        onclick={() => removeTag(i)}
      >×</button>
    </span>
  {/each}
</div>
<div class="tag-input-row">
  <input
    type="text"
    class="field-input tag-input"
    {id}
    placeholder="Type and press Enter…"
    bind:value={inputText}
    onkeydown={handleKeydown}
  />
  <button type="button" class="tag-add-button" onclick={addTag}>Add</button>
</div>

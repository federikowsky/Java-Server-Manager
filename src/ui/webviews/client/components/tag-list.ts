/**
 * Tag list component — tag editor for vmArgs, ignoreGlobs, etc.
 */

import type { FormFieldDef } from '../../protocol';

export interface TagListProps {
  def: FormFieldDef;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
}

export function createTagList(props: TagListProps): HTMLElement {
  const { def, value, onChange } = props;
  let tags = [...(value ?? [])];

  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';

  // Label
  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = `field-${def.name}`;
  label.textContent = def.label;
  wrapper.appendChild(label);

  // Tag container
  const tagContainer = document.createElement('div');
  tagContainer.className = 'tag-container';
  tagContainer.dataset.field = def.name;

  // Input row
  const inputRow = document.createElement('div');
  inputRow.className = 'tag-input-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'field-input tag-input';
  input.id = `field-${def.name}`;
  input.placeholder = 'Type and press Enter…';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'tag-add-button';
  addBtn.textContent = 'Add';

  function addTag(): void {
    const val = input.value.trim();
    if (val.length === 0) return;
    tags.push(val);
    input.value = '';
    renderTags();
    onChange(tags);
  }

  addBtn.addEventListener('click', addTag);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  });

  function renderTags(): void {
    tagContainer.innerHTML = '';
    for (let i = 0; i < tags.length; i++) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tags[i];

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tag-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        tags = tags.filter((_, idx) => idx !== i);
        renderTags();
        onChange(tags);
      });

      tag.appendChild(removeBtn);
      tagContainer.appendChild(tag);
    }
  }

  renderTags();

  inputRow.appendChild(input);
  inputRow.appendChild(addBtn);
  wrapper.appendChild(tagContainer);
  wrapper.appendChild(inputRow);

  // Help text
  if (def.helpText) {
    const help = document.createElement('span');
    help.className = 'field-help';
    help.textContent = def.helpText;
    wrapper.appendChild(help);
  }

  // Error slot
  const errorEl = document.createElement('span');
  errorEl.className = 'field-error';
  errorEl.dataset.errorFor = def.name;
  wrapper.appendChild(errorEl);

  return wrapper;
}

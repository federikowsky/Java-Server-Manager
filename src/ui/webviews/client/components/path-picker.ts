/**
 * Path picker component — browse button + path display.
 */

import type { FormFieldDef } from '../../protocol';

export interface PathPickerProps {
  def: FormFieldDef;
  value: string | undefined;
  onChange: (value: string) => void;
  onBrowse: (kind: 'file' | 'directory', filters?: Record<string, string[]>) => void;
}

export function createPathPicker(props: PathPickerProps): HTMLElement {
  const { def, value, onChange, onBrowse } = props;

  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';

  // Label
  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = `field-${def.name}`;
  label.textContent = def.label;
  if (def.required) {
    const req = document.createElement('span');
    req.className = 'required-mark';
    req.textContent = ' *';
    label.appendChild(req);
  }
  wrapper.appendChild(label);

  // Input row
  const row = document.createElement('div');
  row.className = 'path-picker-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'field-input path-input';
  input.id = `field-${def.name}`;
  input.dataset.field = def.name;
  if (value) input.value = value;
  if (def.readOnly) input.readOnly = true;
  if (def.placeholder) input.placeholder = def.placeholder;

  input.addEventListener('change', () => onChange(input.value));

  const browseBtn = document.createElement('button');
  browseBtn.type = 'button';
  browseBtn.className = 'browse-button';
  browseBtn.textContent = 'Browse…';
  browseBtn.addEventListener('click', () => {
    const kind = def.browse?.kind ?? 'directory';
    onBrowse(kind, def.browse?.filters);
  });

  row.appendChild(input);
  row.appendChild(browseBtn);
  wrapper.appendChild(row);

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

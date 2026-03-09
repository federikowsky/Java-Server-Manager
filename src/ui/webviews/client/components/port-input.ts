/**
 * Port input component — number input with port-range validation.
 */

import type { FormFieldDef } from '../../protocol';

export interface PortInputProps {
  def: FormFieldDef;
  value: number | undefined;
  onChange: (value: number) => void;
}

export function createPortInput(props: PortInputProps): HTMLElement {
  const { def, value, onChange } = props;

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

  // Port input
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'field-input port-input';
  input.id = `field-${def.name}`;
  input.dataset.field = def.name;
  input.min = String(def.validation?.min ?? 1);
  input.max = String(def.validation?.max ?? 65535);
  if (value !== null && value !== undefined) input.value = String(value);
  else if (def.defaultValue !== null && def.defaultValue !== undefined) input.value = String(def.defaultValue);
  if (def.readOnly) input.readOnly = true;

  input.addEventListener('change', () => {
    const num = Number(input.value);
    if (Number.isFinite(num)) onChange(num);
  });

  wrapper.appendChild(input);

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

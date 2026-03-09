/**
 * Generic form field component.
 * Renders: text, number, select, checkbox, textarea.
 */

import type { FormFieldDef } from '../../protocol';

export interface FormFieldProps {
  def: FormFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function createFormField(props: FormFieldProps): HTMLElement {
  const { def, value, onChange } = props;

  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  if (def.visibleWhen) {
    wrapper.dataset.visibleWhen = JSON.stringify(def.visibleWhen);
  }

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

  // Input element
  let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

  switch (def.type) {
    case 'select':
      input = createSelect(def, value);
      break;
    case 'checkbox':
      input = createCheckbox(def, value);
      break;
    case 'textarea':
      input = createTextarea(def, value);
      break;
    case 'number':
      input = createNumberInput(def, value);
      break;
    default:
      input = createTextInput(def, value);
      break;
  }

  input.id = `field-${def.name}`;
  input.dataset.field = def.name;
  if (def.readOnly) input.setAttribute('readonly', 'true');

  input.addEventListener('change', () => {
    if (def.type === 'checkbox') {
      onChange((input as HTMLInputElement).checked);
    } else if (def.type === 'number') {
      onChange(Number((input as HTMLInputElement).value));
    } else {
      onChange(input.value);
    }
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function createTextInput(def: FormFieldDef, value: unknown): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'field-input';
  if (def.placeholder) input.placeholder = def.placeholder;
  if (value !== null && value !== undefined) input.value = String(value);
  return input;
}

function createNumberInput(def: FormFieldDef, value: unknown): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'field-input';
  if (def.validation?.min !== null && def.validation?.min !== undefined) input.min = String(def.validation.min);
  if (def.validation?.max !== null && def.validation?.max !== undefined) input.max = String(def.validation.max);
  if (value !== null && value !== undefined) input.value = String(value);
  return input;
}

function createSelect(def: FormFieldDef, value: unknown): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'field-input';
  for (const opt of def.options ?? []) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === String(value ?? def.defaultValue ?? '')) {
      option.selected = true;
    }
    select.appendChild(option);
  }
  return select;
}

function createCheckbox(def: FormFieldDef, value: unknown): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'field-checkbox';
  input.checked = Boolean(value ?? def.defaultValue ?? false);
  return input;
}

function createTextarea(def: FormFieldDef, value: unknown): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.className = 'field-input field-textarea';
  textarea.rows = 4;
  if (def.placeholder) textarea.placeholder = def.placeholder;
  if (value !== null && value !== undefined) textarea.value = String(value);
  return textarea;
}

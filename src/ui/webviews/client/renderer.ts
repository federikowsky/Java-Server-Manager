/**
 * Schema-driven form renderer (§7.9.4).
 *
 * Takes a FormSchema and renders it to the DOM.
 * Each FormFieldDef.type maps to a component from `./components/`.
 */

import type { FormSchema, FormSection, FormFieldDef, FieldError } from '../protocol';
import { createFormField } from './components/form-field';
import { createPathPicker } from './components/path-picker';
import { createPortInput } from './components/port-input';
import { createTagList } from './components/tag-list';
import { createSection } from './components/section';

// ── State ───────────────────────────────────────────────────────────────────

/** Current form data, keyed by field name. */
const formData: Record<string, unknown> = {};

/** Callbacks for field value changes. */
type ChangeCallback = (name: string, value: unknown) => void;
type BrowseCallback = (field: string, kind: 'file' | 'directory', filters?: Record<string, string[]>) => void;

let onChangeCallback: ChangeCallback = () => {};
let onBrowseCallback: BrowseCallback = () => {};

// ── Public API ──────────────────────────────────────────────────────────────

export function setOnChange(cb: ChangeCallback): void {
  onChangeCallback = cb;
}

export function setOnBrowse(cb: BrowseCallback): void {
  onBrowseCallback = cb;
}

/** Get current form data snapshot. */
export function getFormData(): Record<string, unknown> {
  return { ...formData };
}

/** Set a single field value (e.g. from host `browsed` message). */
export function setFieldValue(name: string, value: unknown): void {
  formData[name] = value;
  const input = document.querySelector(`[data-field="${name}"]`) as HTMLInputElement | null;
  if (input) {
    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else {
      input.value = String(value ?? '');
    }
  }
}

/** Populate form with data (e.g. from host `init` or `loaded` message). */
export function populateForm(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    formData[key] = value;
    setFieldValue(key, value);
  }
}

/** Display validation errors on fields. */
export function showErrors(errors: FieldError[]): void {
  // Clear all existing errors
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('visible');
  });

  for (const err of errors) {
    const errorEl = document.querySelector(`[data-error-for="${err.field}"]`);
    if (errorEl) {
      errorEl.textContent = err.suggestedFix ? `${err.message} ${err.suggestedFix}` : err.message;
      errorEl.classList.add('visible');
    }
  }
}

/** Show a single field error (from fieldValidationResult). */
export function showFieldError(field: string, error?: string): void {
  const errorEl = document.querySelector(`[data-error-for="${field}"]`);
  if (errorEl) {
    errorEl.textContent = error ?? '';
    if (error) {
      errorEl.classList.add('visible');
    } else {
      errorEl.classList.remove('visible');
    }
  }
}

/** Render the entire form into the root element. */
export function renderForm(root: HTMLElement, schema: FormSchema): void {
  root.innerHTML = '';

  const title = document.createElement('h1');
  title.className = 'form-title';
  title.textContent = schema.title;
  root.appendChild(title);

  const form = document.createElement('form');
  form.className = 'jsm-form';
  form.addEventListener('submit', e => e.preventDefault());

  for (const section of schema.sections) {
    const sectionEl = renderSection(section);
    form.appendChild(sectionEl);
  }

  root.appendChild(form);
}

// ── Internal rendering ──────────────────────────────────────────────────────

function renderSection(section: FormSection): HTMLElement {
  const fields = section.fields.map(field => renderField(field));

  return createSection({
    id: section.id,
    title: section.title,
    collapsible: section.collapsible ?? false,
    children: fields,
  });
}

function renderField(def: FormFieldDef): HTMLElement {
  // Initialize default value
  if (def.defaultValue !== undefined && formData[def.name] === undefined) {
    formData[def.name] = def.defaultValue;
  }

  const handleChange = (value: unknown) => {
    formData[def.name] = value;
    onChangeCallback(def.name, value);
  };

  switch (def.type) {
    case 'path':
      return createPathPicker({
        def,
        value: formData[def.name] as string | undefined,
        onChange: handleChange,
        onBrowse: (kind, filters) => onBrowseCallback(def.name, kind, filters),
      });

    case 'port':
      return createPortInput({
        def,
        value: formData[def.name] as number | undefined,
        onChange: handleChange,
      });

    case 'tags':
      return createTagList({
        def,
        value: formData[def.name] as string[] | undefined,
        onChange: handleChange,
      });

    default:
      return createFormField({
        def,
        value: formData[def.name],
        onChange: handleChange,
      });
  }
}

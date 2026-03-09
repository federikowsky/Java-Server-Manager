/**
 * Server form view — page-level overrides/extensions for the server form.
 *
 * In v1 with vanilla TS rendering, the generic renderer handles
 * the FormSchema directly. This view provides server-specific
 * hooks for post-render customization.
 */

import type { HostToWebview } from '../../protocol';
import {
  renderForm,
  populateForm,
  showErrors,
  showFieldError,
  setFieldValue,
  getFormData,
  setOnChange,
  setOnBrowse,
} from '../renderer';
import { sendSubmit, sendValidateField, sendBrowse, sendCancel } from '../bridge';

/** Initialize the server form view from an `init` message. */
export function initServerForm(msg: Extract<HostToWebview, { command: 'init' }>): void {
  const root = document.getElementById('root');
  if (!root) return;

  renderForm(root, msg.schema);

  if (msg.data) {
    populateForm(msg.data);
  }

  setOnChange((name, value) => {
    sendValidateField(name, value);
  });

  setOnBrowse((field, kind, filters) => {
    sendBrowse(field, kind, filters);
  });

  addFormButtons(root, msg.mode);
}

/** Handle host messages for the server form. */
export function handleServerFormMessage(msg: HostToWebview): void {
  switch (msg.command) {
    case 'loaded':
      populateForm(msg.data);
      break;
    case 'validationErrors':
      showErrors(msg.errors);
      break;
    case 'fieldValidationResult':
      showFieldError(msg.field, msg.error);
      break;
    case 'browsed':
      setFieldValue(msg.field, msg.path);
      break;
    case 'defaults':
      populateForm(msg.data);
      break;
    case 'error':
      showGlobalError(msg.message);
      break;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function addFormButtons(root: HTMLElement, mode: 'create' | 'edit'): void {
  const bar = document.createElement('div');
  bar.className = 'button-bar';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = mode === 'create' ? 'Create Server' : 'Save Changes';
  submitBtn.addEventListener('click', () => {
    sendSubmit(getFormData());
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => sendCancel());

  bar.appendChild(submitBtn);
  bar.appendChild(cancelBtn);
  root.appendChild(bar);
}

function showGlobalError(message: string): void {
  let banner = document.querySelector('.global-error') as HTMLElement | null;
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'global-error';
    const root = document.getElementById('root');
    if (root) root.prepend(banner);
  }
  banner.textContent = message;
  banner.classList.add('visible');
}

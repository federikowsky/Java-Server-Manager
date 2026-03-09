/**
 * Webview client entry point (§5.2, §7.9).
 *
 * Router: dispatches incoming `init` messages to the correct view.
 * Compiled by esbuild as IIFE → dist/webview/webview.js
 */

import type { HostToWebview } from '../protocol';
import { sendReady, onHostMessage } from './bridge';
import { initServerForm, handleServerFormMessage } from './views/server-form';
import { initDeploymentForm, handleDeploymentFormMessage } from './views/deployment-form';

// ── State ───────────────────────────────────────────────────────────────────

let activeFormId: string | undefined;

// ── Router ──────────────────────────────────────────────────────────────────

function handleMessage(msg: HostToWebview): void {
  if (msg.command === 'init') {
    activeFormId = msg.formId;

    switch (msg.formId) {
      case 'jsm.serverForm':
        initServerForm(msg);
        break;
      case 'jsm.deploymentForm':
        initDeploymentForm(msg);
        break;
      default:
        console.warn(`[JSM] Unknown form ID: ${msg.formId}`);
    }
    return;
  }

  // Route non-init messages to the active view handler
  switch (activeFormId) {
    case 'jsm.serverForm':
      handleServerFormMessage(msg);
      break;
    case 'jsm.deploymentForm':
      handleDeploymentFormMessage(msg);
      break;
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

onHostMessage(handleMessage);
sendReady();

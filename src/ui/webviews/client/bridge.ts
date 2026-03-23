/**
 * Typed postMessage bridge for webview ↔ extension host communication (§3.13).
 *
 * Runs in the webview iframe (browser context).
 * Uses the VS Code webview API acquired via `acquireVsCodeApi()`.
 */

import type { WebviewToHost, HostToWebview } from '../protocol';
import { WEBVIEW_PROTOCOL_VERSION } from '../protocol';

// The VS Code webview API is injected into the iframe by the host.
interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

function getApi(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}

/** Send a typed message from webview to extension host. */
export function postToHost(msg: WebviewToHost): void {
  getApi().postMessage(msg);
}

/** Convenience: send a typed message with protocol version auto-filled. */
export function sendReady(): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'ready' });
}

export function sendSubmit(data: Record<string, unknown>): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'submit', data });
}

export function sendValidate(data: Record<string, unknown>): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'validate', data });
}

export function sendValidateField(field: string, value: unknown): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'validateField', field, value });
}

export function sendBrowse(
  field: string,
  kind: 'file' | 'directory',
  filters?: Record<string, string[]>,
): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'browse', field, kind, filters });
}

export function sendCancel(): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'cancel' });
}

// ── SPA Command Helpers ─────────────────────────────────────────────────────

export function sendExecuteCommand(id: string, args?: unknown[], requestId?: string): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'executeCommand', id, args, requestId });
}

export function sendDeleteServer(serverId: string, workspaceFolderUri: string): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'deleteServer', serverId, workspaceFolderUri });
}

export function sendSaveTemplate(template: unknown, scope: 'global' | 'workspace'): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'saveTemplate', template, scope });
}

export function sendDeleteTemplate(templateId: string, scope: 'global' | 'workspace'): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'deleteTemplate', templateId, scope });
}

export function sendRequestWorkspaceFolders(): void {
  postToHost({ v: WEBVIEW_PROTOCOL_VERSION, command: 'requestWorkspaceFolders' });
}

// ── Listener ────────────────────────────────────────────────────────────────

type HostMessageHandler = (msg: HostToWebview) => void;

/**
 * Listen for messages from the extension host.
 * Messages with invalid/missing protocol version are silently dropped (§3.13).
 */
export function onHostMessage(handler: HostMessageHandler): void {
  window.addEventListener('message', (event: MessageEvent) => {
    const raw: unknown = event.data;
    if (typeof raw !== 'object' || raw === null) return;
    const msg = raw as Record<string, unknown>;
    if (msg['v'] !== WEBVIEW_PROTOCOL_VERSION) {
      console.warn('[JSM] Discarding message with unknown protocol version:', msg['v']);
      return;
    }
    handler(raw as HostToWebview);
  });
}

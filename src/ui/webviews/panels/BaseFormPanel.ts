import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type {
  FormSchema,
  HostToWebview,
  WebviewToHost,
} from '../protocol';
import { WEBVIEW_PROTOCOL_VERSION } from '../protocol';

/**
 * Abstract base for all webview form panels (§7.9.7).
 *
 * Provides:
 * - Panel lifecycle (create, reveal, dispose)
 * - CSP + nonce enforcement (§7.9.3)
 * - Typed postMessage (§3.13)
 * - showForm() lifecycle wrapper
 *
 * Subclasses implement:
 * - getFormSchema() — declarative form definition
 * - handleMessage() — incoming message routing
 */
export abstract class BaseFormPanel implements vscode.Disposable {
  protected panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly extensionUri: vscode.Uri;
  private readonly viewType: string;
  private readonly title: string;

  constructor(extensionUri: vscode.Uri, viewType: string, title: string) {
    this.extensionUri = extensionUri;
    this.viewType = viewType;
    this.title = title;
  }

  // ── Abstract contract ───────────────────────────────────────────────

  /** Return the declarative form definition for this panel. */
  abstract getFormSchema(mode: 'create' | 'edit'): FormSchema;

  /** Handle an incoming message from the webview. */
  abstract handleMessage(msg: WebviewToHost): void | Promise<void>;

  // ── Panel lifecycle ─────────────────────────────────────────────────

  /**
   * Show the form panel. Creates a new panel or reveals existing one.
   */
  show(mode: 'create' | 'edit', data?: Record<string, unknown>): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
    } else {
      this.createPanel();
    }

    const schema = this.getFormSchema(mode);
    this.postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'init',
      formId: this.viewType,
      mode,
      data,
      schema,
    });
  }

  /** Send a typed message to the webview. */
  protected postMessage(msg: HostToWebview): void {
    this.panel?.webview.postMessage(msg);
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private createPanel(): void {
    const distWebview = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');

    this.panel = vscode.window.createWebviewPanel(
      this.viewType,
      this.title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [distWebview],
        retainContextWhenHidden: false,
      },
    );

    this.panel.webview.html = this.buildHtml(this.panel.webview, distWebview);

    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        if (!isValidProtocolMessage(raw)) return;
        void this.handleMessage(raw);
      },
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables,
    );
  }

  /**
   * Build the webview HTML with CSP + nonce (§7.9.3).
   */
  private buildHtml(webview: vscode.Webview, distWebview: vscode.Uri): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distWebview, 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distWebview, 'webview.css'),
    );
    const cspSource = webview.cspSource;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; font-src ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>${escapeHtml(this.title)}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isValidProtocolMessage(raw: unknown): raw is WebviewToHost {
  if (typeof raw !== 'object' || raw === null) return false;
  const msg = raw as Record<string, unknown>;
  return msg['v'] === WEBVIEW_PROTOCOL_VERSION && typeof msg['command'] === 'string';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

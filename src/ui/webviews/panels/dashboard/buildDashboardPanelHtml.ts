import * as vscode from 'vscode';
import * as crypto from 'crypto';

export function buildDashboardPanelHtml(webview: vscode.Webview, distWebview: vscode.Uri): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'webview.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'webview.css'));
  const cspSource = webview.cspSource;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}'; font-src ${cspSource}; img-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Java Server Manager</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    // Signal SPA mode
    window.__JSM_SPA_MODE__ = true;
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

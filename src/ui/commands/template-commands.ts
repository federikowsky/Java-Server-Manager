import * as vscode from 'vscode';
import type { TemplateService } from '@app/templates/TemplateService';
import { registerMany } from './shared';

// ── Dependency contract ─────────────────────────────────────────────────────

export interface TemplateCommandsDeps {
  templateService: TemplateService;
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerTemplateCommands(
  deps: TemplateCommandsDeps,
): vscode.Disposable[] {
  const { templateService: _templateService } = deps;

  return registerMany([
    // §8.3 — jsm.templates.manage (opens template management UI; wired in Phase 7)
    ['jsm.templates.manage', () => {
      void vscode.window.showInformationMessage(
        'Template management UI will be available after webview wiring (Phase 7).',
      );
    }],
  ]);
}

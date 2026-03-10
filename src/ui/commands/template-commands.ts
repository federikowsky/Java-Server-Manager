import * as vscode from 'vscode';
import type { TemplateManagerPanel } from '@ui/webviews/panels/TemplateManagerPanel';
import { registerMany } from './shared';

// ── Dependency contract ─────────────────────────────────────────────────────

export interface TemplateCommandsDeps {
  templateManagerPanel: TemplateManagerPanel;
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerTemplateCommands(
  deps: TemplateCommandsDeps,
): vscode.Disposable[] {
  const { templateManagerPanel } = deps;

  return registerMany([
    ['jsm.templates.manage', () => templateManagerPanel.open()],
  ]);
}

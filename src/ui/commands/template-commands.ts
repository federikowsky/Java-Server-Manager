import * as vscode from 'vscode';
import type { TemplateService } from '@app/templates/TemplateService';
import { deferredStub, registerMany } from './shared';

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
    // §8.3 — jsm.templates.manage (deferred-v1.1)
    ['jsm.templates.manage', deferredStub('Template Management')],
  ]);
}

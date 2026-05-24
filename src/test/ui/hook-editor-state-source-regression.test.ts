/**
 * UI-HOOK-STATE: Regression guard for the full-screen hooks editor.
 * The project does not use a DOM/Svelte interaction harness, so this keeps the
 * critical source-level contracts that prevent draft loss when the editor
 * temporarily replaces a wizard page.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('hooks editor state contracts', () => {
  it('keeps HookList locally reactive after adding command or task hooks', () => {
    const src = readSource('src/ui/webviews/client/components/HookList.svelte');

    expect(src).toContain('let hooks = $state<HookConfig[]>([])');
    expect(src).toContain('hooks = normalizedHooks;');
    expect(src).toContain('onChange(normalizedHooks);');
    expect(src).toMatch(/\{\s*def,\s*value,\s*onChange,\s*id,\s*onTest,\s*testState\s*\}/);
  });

  it('persists Add Server draft state while the hooks editor is open', () => {
    const src = readSource('src/ui/webviews/client/components/spa/forms/ServerWizard.svelte');

    expect(src).toContain('serverWizardDraft');
    expect(src).toContain('snapshotServerWizardDraft');
    expect(src).toContain('restoreServerWizardDraft(savedDraft)');
    expect(src).toContain('serverWizardDraft.set(snapshot)');
  });

  it('persists deployment draft state while the hooks editor is open', () => {
    const src = readSource('src/ui/webviews/client/components/spa/forms/DeploymentWizard.svelte');

    expect(src).toContain('deploymentWizardDraft');
    expect(src).toContain('snapshotDeploymentWizardDraft');
    expect(src).toContain('restoreDeploymentWizardDraft(savedDraft)');
    expect(src).toContain('deploymentWizardDraft.set(snapshot)');
  });
});

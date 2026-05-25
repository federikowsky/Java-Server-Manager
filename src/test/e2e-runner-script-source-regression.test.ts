/**
 * E2E-SCRIPT-001: @vscode/test-electron runTests prepends launchArgs before
 * --extensionTestsPath. JSM's E2E scripts must launch VS Code with test flags
 * first and the workspace path last, otherwise VS Code may interpret the
 * workspace path as the extension test module.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readScript(name: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), 'scripts/e2e', name), 'utf-8');
}

describe('E2E launch scripts', () => {
  it('uses the local launcher instead of runTests launchArgs for workspace paths', () => {
    for (const script of ['run-e2e.mjs', 'run-e2e-full.mjs']) {
      const src = readScript(script);
      expect(src).toContain('runVsCodeExtensionTests');
      expect(src).toMatch(/workspacePath:\s*(tmp|workspace)/);
      expect(src).not.toContain('runTests');
      expect(src).not.toContain('launchArgs');
    }
  });

  it('keeps the workspace path last in the local VS Code launcher', () => {
    const src = readScript('run-vscode-extension-tests.mjs');
    expect(src).toContain('`--extensionTestsPath=${options.extensionTestsPath}`');
    expect(src).toContain('`--extensionDevelopmentPath=${options.extensionDevelopmentPath}`');
    expect(src).toMatch(/options\.workspacePath,\s*\]/);
  });

  it('retries temporary VS Code profile cleanup for delayed filesystem writes', () => {
    const src = readScript('run-vscode-extension-tests.mjs');
    expect(src).toContain('removeTempDir');
    expect(src).toContain('maxRetries');
    expect(src).toContain('retryDelay');
  });
});

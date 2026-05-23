/**
 * Workbench E2E: real vscode.workspace file watcher → autosync → DeploySync operation.
 * Requires JSM_E2E=1 (set by scripts/e2e/run-e2e.mjs via extensionTestsEnv).
 */
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

/** Must match `JsmExtensionE2EApi` returned by `activate()` when JSM_E2E=1 (local copy avoids compiling extension.ts in e2e project). */
type JsmExtensionE2EApi = {
  __e2eGetDeploySyncStartedCount: () => number;
  __e2eGetAutosyncWatcherCount: () => number;
};

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  assert.fail(message);
}

suite('E2E / autosync → DeploySync', () => {
  test('filesystem change under exploded deployment enqueues DeploySync', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'workspace folder');

    const ext = vscode.extensions.getExtension('federikowsky.java-server-manager');
    assert.ok(ext, 'JSM extension present');

    const api = (await ext.activate()) as JsmExtensionE2EApi | void;
    assert.ok(
      api && typeof api.__e2eGetDeploySyncStartedCount === 'function',
      'E2E API missing — extension must run with JSM_E2E=1',
    );
    assert.equal(
      typeof api.__e2eGetAutosyncWatcherCount,
      'function',
      'E2E autosync watcher API missing',
    );

    await waitFor(
      () => api!.__e2eGetAutosyncWatcherCount() > 0,
      'expected autosync watcher to be registered before filesystem change',
    );

    const before = api!.__e2eGetDeploySyncStartedCount();
    const exploded = path.join(folder.uri.fsPath, 'exploded');
    const marker = path.join(exploded, `e2e-autosync-${Date.now()}.txt`);
    await fs.writeFile(marker, 'trigger', 'utf8');

    const debounceMs = 450;
    const deadline = Date.now() + 30_000;
    let after = before;
    while (Date.now() < deadline && after === before) {
      await new Promise(r => setTimeout(r, debounceMs));
      after = api!.__e2eGetDeploySyncStartedCount();
    }

    assert.ok(
      after > before,
      `expected DeploySync to start (count before=${before} after=${after})`,
    );
  });
});

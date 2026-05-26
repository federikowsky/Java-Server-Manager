/**
 * Full E2E on a real Maven workspace: pom.xml, migrated JSM inventory, WAR autosync after atomic replace.
 * Run only via `npm run test:e2e:full` (JSM_E2E_FULL=1 + JSM_E2E=1).
 */
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

type JsmExtensionE2EApi = {
  __e2eGetDeploySyncStartedCount: () => number;
  __e2eGetLoadedServers: () => JsmServersFile['servers'];
};

type JsmServersFile = {
  servers: Array<{
    deployments: Array<{ type: string; sourcePath: string; syncMode?: string }>;
  }>;
};

async function getJsmApi(): Promise<JsmExtensionE2EApi> {
  const ext = vscode.extensions.getExtension('federikowsky.java-server-manager');
  assert.ok(ext);
  const api = (await ext.activate()) as JsmExtensionE2EApi | void;
  assert.ok(
    api
    && typeof api.__e2eGetDeploySyncStartedCount === 'function'
    && typeof api.__e2eGetLoadedServers === 'function',
    'JSM_E2E=1 required for this test',
  );
  return api;
}

suite('E2E full / reply-cop + Maven WAR', () => {
  test('workspace has pom.xml and JSM inventory', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'workspace folder');
    const root = folder.uri.fsPath;
    await fs.access(path.join(root, 'pom.xml'));

    const api = await getJsmApi();
    assert.ok(api.__e2eGetLoadedServers().length > 0, 'expected at least one loaded JSM server');
  });

  test('WAR path from loaded inventory exists (mvn ran before VS Code)', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const root = folder.uri.fsPath;
    const api = await getJsmApi();
    const warDep = api.__e2eGetLoadedServers().flatMap(s => s.deployments).find(d => d.type === 'war');
    assert.ok(warDep, 'expected a WAR deployment in loaded JSM inventory');
    const warPath = path.isAbsolute(warDep.sourcePath)
      ? warDep.sourcePath
      : path.join(root, warDep.sourcePath);
    await fs.access(warPath);
    const st = await fs.stat(warPath);
    assert.ok(st.isFile() && st.size > 0, 'WAR must be a non-empty file after mvn package');
  });

  test('atomic WAR replace triggers DeploySync (autosync)', async function () {
    this.timeout(120_000);
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const root = folder.uri.fsPath;
    const api = await getJsmApi();

    const warDep = api.__e2eGetLoadedServers().flatMap(s => s.deployments).find(d => d.type === 'war' && d.syncMode === 'auto');
    assert.ok(warDep, 'expected WAR deployment with syncMode auto');

    const warPath = path.isAbsolute(warDep.sourcePath)
      ? warDep.sourcePath
      : path.join(root, warDep.sourcePath);
    await fs.access(warPath);

    const before = api.__e2eGetDeploySyncStartedCount();
    const tmp = `${warPath}.jsm-e2e.${Date.now()}.tmp`;
    await fs.copyFile(warPath, tmp);
    await fs.rename(tmp, warPath);

    const debounceMs = 450;
    const deadline = Date.now() + 45_000;
    let after = before;
    while (Date.now() < deadline && after === before) {
      await new Promise(r => setTimeout(r, debounceMs));
      after = api.__e2eGetDeploySyncStartedCount();
    }

    assert.ok(
      after > before,
      `expected DeploySync after WAR replace (before=${before} after=${after}). Is the server running in JSM and autosync enabled?`,
    );
  });
});

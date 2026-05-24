#!/usr/bin/env node
/**
 * Builds a disposable workspace, launches VS Code test host with JSM_E2E=1, runs the E2E suite.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVsCodeExtensionTests } from './run-vscode-extension-tests.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const vscodeExecutablePath = process.env.JSM_E2E_VSCODE_EXECUTABLE?.trim() || undefined;

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const DEPLOYMENT_ID = '22222222-2222-4222-8222-222222222222';

function workspaceConfig(payload) {
  return {
    servers: [
      {
        id: SERVER_ID,
        name: 'E2E Tomcat',
        type: 'tomcat',
        runtime: {
          id: 'rt-e2e',
          homePath: payload.tomcatHome,
          version: 'e2e',
        },
        instancePath: payload.instancePath,
        javaHome: path.join(os.tmpdir(), 'jsm-e2e-java-stub'),
        host: '127.0.0.1',
        ports: { http: 58080, debug: 55005 },
        run: { env: {}, vmArgs: [] },
        debug: { enabled: false, bind: '127.0.0.1', attachDelayMs: 0 },
        deployments: [
          {
            id: DEPLOYMENT_ID,
            type: 'exploded',
            sourcePath: payload.explodedPath,
            deployName: 'e2eapp',
            syncMode: 'auto',
            hotReload: false,
            ignoreGlobs: [],
            hooks: [],
          },
        ],
        autosync: {
          enabled: true,
          debounceMs: 400,
          maxBatchFiles: 200,
          maxBatchBytes: 20_000_000,
          stormBackoffMs: 2000,
          ignoreGlobs: [],
        },
        hooks: [],
        pluginConfig: { type: 'tomcat', shutdownPort: 58005, disableAjp: true },
      },
    ],
  };
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-e2e-'));
  let exitCode = 1;
  try {
    const vscodeDir = path.join(tmp, '.vscode');
    const explodedPath = path.join(tmp, 'exploded');
    const instancePath = path.join(tmp, 'instance');
    const tomcatHome = path.join(tmp, 'tomcat-home');

    await fs.mkdir(vscodeDir, { recursive: true });
    await fs.mkdir(explodedPath, { recursive: true });
    await fs.mkdir(path.join(instancePath, 'webapps'), { recursive: true });
    await fs.mkdir(tomcatHome, { recursive: true });
    await fs.writeFile(path.join(explodedPath, 'placeholder.txt'), 'e2e', 'utf8');

    const cfg = workspaceConfig({
      explodedPath,
      instancePath,
      tomcatHome,
    });
    await fs.writeFile(path.join(vscodeDir, 'jsm.servers.json'), `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');

    exitCode = await runVsCodeExtensionTests({
      extensionDevelopmentPath: repoRoot,
      extensionTestsPath: path.join(repoRoot, 'out', 'e2e', 'suite', 'index.js'),
      workspacePath: tmp,
      vscodeExecutablePath,
      extensionTestsEnv: {
        JSM_E2E: '1',
      },
    });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

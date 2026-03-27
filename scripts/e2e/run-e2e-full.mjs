#!/usr/bin/env node
/**
 * Full E2E: `mvn package` in a real Maven workspace, then VS Code test host with JSM_E2E.
 *
 * Default workspace: reply-cop (override with JSM_E2E_WORKSPACE or first CLI argument).
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const DEFAULT_WORKSPACE = '/Users/federicofilippi/Desktop/tamtamy/cop/reply-cop';

function runMvnPackage(cwd) {
  console.log('[e2e-full] mvn -B -q -DskipTests package in', cwd);
  const r = spawnSync('mvn', ['-B', '-q', '-DskipTests', 'package'], {
    cwd,
    stdio: 'inherit',
    env: process.env,
    timeout: 600_000,
  });
  if (r.error) {
    console.error('[e2e-full] mvn spawn failed:', r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error('[e2e-full] mvn exited with code', r.status);
    process.exit(r.status ?? 1);
  }
}

async function main() {
  const workspace =
    process.argv[2] || process.env.JSM_E2E_WORKSPACE || DEFAULT_WORKSPACE;

  if (!existsSync(workspace)) {
    console.error('[e2e-full] workspace does not exist:', workspace);
    process.exit(1);
  }

  const pom = path.join(workspace, 'pom.xml');
  if (!existsSync(pom)) {
    console.error('[e2e-full] not a Maven project (missing pom.xml):', workspace);
    process.exit(1);
  }

  runMvnPackage(workspace);

  const jsmConfig = path.join(workspace, '.vscode', 'jsm.servers.json');
  if (!existsSync(jsmConfig)) {
    console.error('[e2e-full] missing', jsmConfig);
    process.exit(1);
  }

  const exitCode = await runTests({
    extensionDevelopmentPath: repoRoot,
    extensionTestsPath: path.join(repoRoot, 'out', 'e2e', 'suite', 'index-full.js'),
    launchArgs: [workspace],
    extensionTestsEnv: {
      JSM_E2E: '1',
      JSM_E2E_FULL: '1',
    },
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

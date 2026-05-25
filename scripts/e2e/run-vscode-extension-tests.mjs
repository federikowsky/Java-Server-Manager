import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
  TestRunFailedError,
} from '@vscode/test-electron';

export async function runVsCodeExtensionTests(options) {
  const vscodeExecutablePath = options.vscodeExecutablePath || await downloadAndUnzipVSCode();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-vscode-user-'));
  const extensionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-vscode-ext-'));

  const args = [
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    `--extensionTestsPath=${options.extensionTestsPath}`,
    `--extensionDevelopmentPath=${options.extensionDevelopmentPath}`,
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    options.workspacePath,
  ];

  try {
    const vscodeCliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
    return await runProcess(vscodeCliPath, args, options.extensionTestsEnv);
  } finally {
    await Promise.all([
      removeTempDir(userDataDir),
      removeTempDir(extensionsDir),
    ]);
  }
}

async function removeTempDir(dir) {
  const retryableCodes = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM']);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      return;
    } catch (error) {
      if (!retryableCodes.has(error?.code) || attempt === 4) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

function runProcess(executable, args, testRunnerEnv) {
  const fullEnv = { ...process.env, ...testRunnerEnv };
  const shell = process.platform === 'win32';
  const child = spawn(shell ? `"${executable}"` : executable, args, {
    env: fullEnv,
    shell,
  });

  return new Promise((resolve, reject) => {
    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => process.stderr.write(data));
    child.on('error', reject);
    child.on('close', code => {
      console.log(`Exit code:   ${code}`);
      if (code === 0) {
        resolve(0);
        return;
      }
      reject(new TestRunFailedError(code ?? undefined, undefined));
    });
  });
}

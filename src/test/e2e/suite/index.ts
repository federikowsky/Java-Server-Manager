/**
 * VS Code extension test runner entry — loaded via --extensionTestsPath.
 */
import { runE2eSuite } from './e2eRunner';

export function run(): Promise<void> {
  return runE2eSuite({
    suiteDir: __dirname,
    pattern: /^(?!.*\.full\.e2e\.js$).*\.e2e\.js$/u,
    timeoutMs: 120_000,
  });
}

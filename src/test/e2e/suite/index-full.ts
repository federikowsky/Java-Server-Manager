/**
 * E2E runner for real-workspace scenarios (mvn + reply-cop). Loaded via run-e2e-full.mjs only.
 */
import { runE2eSuite } from './e2eRunner';

export function run(): Promise<void> {
  return runE2eSuite({
    suiteDir: __dirname,
    pattern: /\.full\.e2e\.js$/u,
    timeoutMs: 300_000,
  });
}

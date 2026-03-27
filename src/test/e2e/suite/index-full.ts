/**
 * E2E runner for real-workspace scenarios (mvn + reply-cop). Loaded via run-e2e-full.mjs only.
 */
import * as path from 'path';
import Mocha from 'mocha';
import { globSync } from 'glob';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 300_000,
  });
  const suiteDir = __dirname;
  return new Promise((resolve, reject) => {
    globSync('**/*.full.e2e.js', { cwd: suiteDir })
      .sort()
      .forEach(f => mocha.addFile(path.join(suiteDir, f)));
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed`));
      } else {
        resolve();
      }
    });
  });
}

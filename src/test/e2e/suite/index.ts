/**
 * VS Code extension test runner entry — loaded via --extensionTestsPath.
 */
import * as path from 'path';
import Mocha from 'mocha';
import { globSync } from 'glob';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 120_000,
  });
  const suiteDir = __dirname;
  return new Promise((resolve, reject) => {
    globSync('**/*.e2e.js', { cwd: suiteDir })
      .filter(f => !f.endsWith('.full.e2e.js'))
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

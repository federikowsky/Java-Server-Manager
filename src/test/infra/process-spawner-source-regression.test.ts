/**
 * INFRA-011: Regression guard — ProcessSpawner must use shell: false (CI also greps for shell + ":true" in src/).
 * Source-level check avoids non-configurable child_process.spawn in the test runtime.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('ProcessSpawner source contract (extended)', () => {
  it('INFRA-011: implementation keeps shell: false in spawn options', () => {
    const spawnerPath = path.resolve(process.cwd(), 'src/infra/process/ProcessSpawner.ts');
    const src = fs.readFileSync(spawnerPath, 'utf-8');
    expect(src).toMatch(/shell:\s*false/);
    expect(src).not.toMatch(/shell:\s*true/);
  });
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runE2eSuite } from './e2e/suite/e2eRunner';

describe('E2E runner', () => {
  const fixtureRoot = path.join(process.cwd(), '.tmp-jsm-e2e-runner-');

  it('runs matching files in sorted order and awaits async tests', async () => {
    const dir = await mkdtemp(fixtureRoot);
    try {
      const events: string[] = [];
      (globalThis as typeof globalThis & { __jsmE2eEvents?: string[] }).__jsmE2eEvents = events;

      await writeFile(
        path.join(dir, 'b.e2e.js'),
        `
suite('b suite', () => {
  test('async b', async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    globalThis.__jsmE2eEvents.push('b');
  });
});
`,
        'utf8',
      );
      await writeFile(
        path.join(dir, 'a.e2e.js'),
        `
suite('a suite', () => {
  test('sync a', () => {
    globalThis.__jsmE2eEvents.push('a');
  });
});
`,
        'utf8',
      );

      await runE2eSuite({ suiteDir: dir, pattern: /\.e2e\.js$/u, timeoutMs: 1000 });

      expect(events).toEqual(['a', 'b']);
    } finally {
      delete (globalThis as typeof globalThis & { __jsmE2eEvents?: string[] }).__jsmE2eEvents;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects when a matching test fails', async () => {
    const dir = await mkdtemp(fixtureRoot);
    try {
      await writeFile(
        path.join(dir, 'failing.e2e.js'),
        `
suite('failing suite', () => {
  test('failing test', () => {
    throw new Error('expected failure');
  });
});
`,
        'utf8',
      );

      await expect(runE2eSuite({ suiteDir: dir, pattern: /\.e2e\.js$/u, timeoutMs: 1000 }))
        .rejects
        .toThrow(/failing suite > failing test/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

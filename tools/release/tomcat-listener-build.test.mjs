import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const buildScript = path.join(repoRoot, 'tools', 'tomcat-startup-listener', 'build.mjs');
const jarPath = path.join(repoRoot, 'assets', 'tomcat', 'jsm-tomcat-startup-listener.jar');

function buildListener() {
  execFileSync(process.execPath, [buildScript], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function hashJar() {
  return createHash('sha256').update(readFileSync(jarPath)).digest('hex');
}

test('Tomcat startup listener build is byte-for-byte reproducible', async () => {
  buildListener();
  const firstHash = hashJar();

  await new Promise(resolve => setTimeout(resolve, 1100));

  buildListener();
  const secondHash = hashJar();

  assert.equal(secondHash, firstHash);
});

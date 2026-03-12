import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(scriptDir, 'src');
const stubDir = path.join(scriptDir, 'stubs');
const buildDir = path.join(scriptDir, 'build');
const classesDir = path.join(buildDir, 'classes');
const assetDir = path.join(scriptDir, '..', '..', 'assets', 'tomcat');
const jarPath = path.join(assetDir, 'jsm-tomcat-startup-listener.jar');

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(classesDir, { recursive: true });
mkdirSync(assetDir, { recursive: true });

const javaFiles = collectJavaFiles(srcDir, stubDir);

run('javac', ['--release', '8', '-encoding', 'UTF-8', '-d', classesDir, ...javaFiles]);
run('jar', ['--create', '--file', jarPath, '-C', classesDir, 'com']);

console.log(`Built ${jarPath}`);

function collectJavaFiles(...roots) {
  return roots.flatMap((root) => walk(root).filter((file) => file.endsWith('.java'))).sort();
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: scriptDir,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`);
  }
}
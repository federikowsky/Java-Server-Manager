import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { atomicWrite, copyDir, ensureDir, exists, readFileSafe } from '@infra/fs/FileUtils';

describe('FileUtils', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsm-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('atomicWrite', () => {
    it('writes a file atomically', async () => {
      const filePath = path.join(tmpDir, 'test.json');
      const result = await atomicWrite(filePath, '{"ok":true}');
      expect(result.ok).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('{"ok":true}');
    });

    it('overwrites an existing file', async () => {
      const filePath = path.join(tmpDir, 'overwrite.json');
      await fs.writeFile(filePath, 'old', 'utf-8');
      const result = await atomicWrite(filePath, 'new');
      expect(result.ok).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('new');
    });

    it('creates parent directories', async () => {
      const filePath = path.join(tmpDir, 'sub', 'dir', 'file.json');
      const result = await atomicWrite(filePath, 'data');
      expect(result.ok).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('data');
    });

    it('cleans up temp file on failure', async () => {
      // Write to a path that's actually a directory — should fail
      const dirPath = path.join(tmpDir, 'adir');
      await fs.mkdir(dirPath);
      const result = await atomicWrite(dirPath, 'data');
      // The exact behavior depends on OS, but it should return an error
      // and no .tmp files should be left behind
      const files = await fs.readdir(tmpDir);
      const tmpFiles = files.filter(f => f.includes('.tmp.'));
      expect(tmpFiles).toHaveLength(0);
      // Result may be ok on some platforms (rename dir → rename), or err.
      // The point is: no temp file leak.
    });
  });

  describe('copyDir', () => {
    it('copies a directory recursively', async () => {
      const src = path.join(tmpDir, 'src-dir');
      const dest = path.join(tmpDir, 'dest-dir');
      await fs.mkdir(path.join(src, 'sub'), { recursive: true });
      await fs.writeFile(path.join(src, 'a.txt'), 'hello');
      await fs.writeFile(path.join(src, 'sub', 'b.txt'), 'world');

      await copyDir(src, dest);

      expect(await fs.readFile(path.join(dest, 'a.txt'), 'utf-8')).toBe('hello');
      expect(await fs.readFile(path.join(dest, 'sub', 'b.txt'), 'utf-8')).toBe('world');
    });
  });

  describe('ensureDir', () => {
    it('creates nested directories', async () => {
      const dir = path.join(tmpDir, 'a', 'b', 'c');
      await ensureDir(dir);
      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('is idempotent', async () => {
      const dir = path.join(tmpDir, 'idem');
      await ensureDir(dir);
      await ensureDir(dir);
      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('exists', () => {
    it('returns true for existing file', async () => {
      const filePath = path.join(tmpDir, 'exists.txt');
      await fs.writeFile(filePath, 'data');
      expect(await exists(filePath)).toBe(true);
    });

    it('returns false for non-existing file', async () => {
      expect(await exists(path.join(tmpDir, 'no.txt'))).toBe(false);
    });
  });

  describe('readFileSafe', () => {
    it('reads an existing file', async () => {
      const filePath = path.join(tmpDir, 'readable.txt');
      await fs.writeFile(filePath, 'content');
      const result = await readFileSafe(filePath);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('content');
    });

    it('returns error for non-existing file', async () => {
      const result = await readFileSafe(path.join(tmpDir, 'missing.txt'));
      expect(result.ok).toBe(false);
    });
  });
});

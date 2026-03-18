import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ok, err, type Result } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { ATOMIC_WRITE_MAX_RETRIES, ATOMIC_WRITE_BACKOFFS_MS } from '../../constants';

// ── Helpers ─────────────────────────────────────────────────────────────────

function tempPath(filePath: string): string {
  return `${filePath}.tmp.${Date.now()}`;
}

function backupPath(filePath: string): string {
  return `${filePath}.bak.${Date.now()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function tryUnlink(p: string): Promise<void> {
  try { await fs.unlink(p); } catch { /* ignore */ }
}

// ── Atomic Write (§4.5) ────────────────────────────────────────────────────

async function atomicWritePosix(filePath: string, tmp: string): Promise<void> {
  await fs.rename(tmp, filePath);
}

async function atomicWriteWindows(filePath: string, tmp: string): Promise<void> {
  const bak = backupPath(filePath);
  let bakCreated = false;

  try {
    // If original exists, rename to .bak
    try {
      await fs.access(filePath);
      await fs.rename(filePath, bak);
      bakCreated = true;
    } catch {
      // Original doesn't exist — first write
    }

    // Rename tmp → target with retry/backoff
    let lastErr: unknown;
    for (let attempt = 0; attempt < ATOMIC_WRITE_MAX_RETRIES; attempt++) {
      try {
        await fs.rename(tmp, filePath);
        // Success — clean up backup
        if (bakCreated) await tryUnlink(bak);
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < ATOMIC_WRITE_MAX_RETRIES - 1) {
          await sleep(ATOMIC_WRITE_BACKOFFS_MS[attempt]);
        }
      }
    }

    // All retries failed — restore backup if we created one
    if (bakCreated) {
      try { await fs.rename(bak, filePath); } catch { /* best effort */ }
    }
    await tryUnlink(tmp);
    throw lastErr;
  } catch (e) {
    // Ensure cleanup on any unexpected error
    await tryUnlink(tmp);
    throw e;
  }
}

/**
 * Atomically write content to a file (§4.5).
 * POSIX: write tmp then rename (atomic overwrite).
 * Windows: backup-first strategy with retry/backoff.
 */
export async function atomicWrite(filePath: string, content: string): Promise<Result<void, JsmError>> {
  const tmp = tempPath(filePath);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmp, content, 'utf-8');

    if (os.platform() === 'win32') {
      await atomicWriteWindows(filePath, tmp);
    } else {
      await atomicWritePosix(filePath, tmp);
    }

    return ok(undefined);
  } catch (cause) {
    await tryUnlink(tmp);
    return err(new JsmError({
      code: ErrorCode.ConfigWriteFailed,
      message: `Atomic write failed: ${filePath}`,
      details: cause instanceof Error ? cause.message : String(cause),
      suggestedFix: ['Check disk/permissions', 'Close conflicting editors'],
      cause,
    }));
  }
}

// ── Directory Utilities ─────────────────────────────────────────────────────

/** Copy a directory recursively. */
export async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/** Ensure a directory exists. */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/** Check if a path exists. */
export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Read a file as UTF-8, returning an error on failure. */
export async function readFileSafe(filePath: string): Promise<Result<string, JsmError>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return ok(content);
  } catch (cause) {
    return err(new JsmError({
      code: ErrorCode.ConfigReadFailed,
      message: `Failed to read: ${filePath}`,
      details: cause instanceof Error ? cause.message : String(cause),
      cause,
    }));
  }
}

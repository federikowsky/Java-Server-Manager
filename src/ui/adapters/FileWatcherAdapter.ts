import * as vscode from 'vscode';
import * as path from 'path';
import type { Disposable } from '@core/types';
import type { FileChange } from '@core/types/events';
import type { FileWatcherFactory } from '@app/sync/AutoSyncService';

/**
 * Implements FileWatcherFactory via vscode.workspace.createFileSystemWatcher (§5.5).
 */
export class FileWatcherAdapter implements FileWatcherFactory {
  watch(
    sourcePath: string,
    ignoreGlobs: string[],
    onChange: (change: FileChange) => void,
  ): Disposable {
    // Build a glob pattern matching all files under sourcePath
    const pattern = new vscode.RelativePattern(sourcePath, '**/*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const shouldIgnore = (uri: vscode.Uri): boolean => {
      const rel = path.relative(sourcePath, uri.fsPath);
      return ignoreGlobs.some(glob => {
        // Simple glob matching — check if pattern appears in path
        // VS Code's watcher doesn't support ignore globs natively,
        // so we do a basic check here.
        const parts = glob.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\//g, '');
        return parts.length > 0 && rel.includes(parts);
      });
    };

    const makeChange = (uri: vscode.Uri, type: FileChange['type']): FileChange => ({
      type,
      path: uri.fsPath,
      relativePath: path.relative(sourcePath, uri.fsPath),
    });

    const createDisp = watcher.onDidCreate(uri => {
      if (!shouldIgnore(uri)) onChange(makeChange(uri, 'add'));
    });
    const changeDisp = watcher.onDidChange(uri => {
      if (!shouldIgnore(uri)) onChange(makeChange(uri, 'change'));
    });
    const deleteDisp = watcher.onDidDelete(uri => {
      if (!shouldIgnore(uri)) onChange(makeChange(uri, 'delete'));
    });

    return {
      dispose(): void {
        createDisp.dispose();
        changeDisp.dispose();
        deleteDisp.dispose();
        watcher.dispose();
      },
    };
  }
}

import * as vscode from 'vscode';
import * as path from 'path';
import type { Disposable } from '@core/types';
import type { FileChange } from '@core/types/events';
import type { FileWatcherFactory } from '@app/sync/AutoSyncService';
import type { WatchSpec } from '@app/sync/watchSpec';

/**
 * Implements FileWatcherFactory via vscode.workspace.createFileSystemWatcher (§5.5).
 */
export class FileWatcherAdapter implements FileWatcherFactory {
  watch(spec: WatchSpec, onChange: (change: FileChange) => void): Disposable {
    if (spec.kind === 'tree') {
      return this.watchTree(spec.root, spec.ignoreGlobs, onChange);
    }
    return this.watchSingleFile(spec.path, onChange);
  }

  private watchTree(
    sourcePath: string,
    ignoreGlobs: string[],
    onChange: (change: FileChange) => void,
  ): Disposable {
    const pattern = new vscode.RelativePattern(sourcePath, '**/*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const shouldIgnore = (uri: vscode.Uri): boolean => {
      const rel = path.relative(sourcePath, uri.fsPath);
      return ignoreGlobs.some(glob => {
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

  private watchSingleFile(filePath: string, onChange: (change: FileChange) => void): Disposable {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const pattern = new vscode.RelativePattern(dir, base);
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const makeChange = (uri: vscode.Uri, type: FileChange['type']): FileChange => ({
      type,
      path: uri.fsPath,
      relativePath: path.relative(dir, uri.fsPath),
    });

    const createDisp = watcher.onDidCreate(uri => {
      onChange(makeChange(uri, 'add'));
    });
    const changeDisp = watcher.onDidChange(uri => {
      onChange(makeChange(uri, 'change'));
    });
    const deleteDisp = watcher.onDidDelete(uri => {
      onChange(makeChange(uri, 'delete'));
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

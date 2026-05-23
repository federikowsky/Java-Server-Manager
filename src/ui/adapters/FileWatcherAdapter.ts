import * as vscode from 'vscode';
import * as path from 'path';
import type { Disposable } from '@core/types';
import type { FileChange } from '@core/types/events';
import type { FileWatcherFactory } from '@app/sync/AutoSyncService';
import type { WatchSpec } from '@app/sync/watchSpec';

function relativeContained(root: string, candidate: string): string | undefined {
  const relative = path.relative(root, candidate);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative;
}

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
      const rel = relativeContained(sourcePath, uri.fsPath);
      if (rel === undefined) {
        return true;
      }
      return ignoreGlobs.some(glob => {
        const parts = glob.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\//g, '');
        return parts.length > 0 && rel.includes(parts);
      });
    };

    const makeChange = (uri: vscode.Uri, type: FileChange['type']): FileChange | undefined => {
      const relativePath = relativeContained(sourcePath, uri.fsPath);
      return relativePath === undefined
        ? undefined
        : {
          type,
          path: uri.fsPath,
          relativePath,
        };
    };

    const createDisp = watcher.onDidCreate(uri => {
      const change = makeChange(uri, 'add');
      if (change && !shouldIgnore(uri)) onChange(change);
    });
    const changeDisp = watcher.onDidChange(uri => {
      const change = makeChange(uri, 'change');
      if (change && !shouldIgnore(uri)) onChange(change);
    });
    const deleteDisp = watcher.onDidDelete(uri => {
      const change = makeChange(uri, 'delete');
      if (change && !shouldIgnore(uri)) onChange(change);
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

    const makeChange = (uri: vscode.Uri, type: FileChange['type']): FileChange | undefined => {
      const relativePath = relativeContained(dir, uri.fsPath);
      if (relativePath !== base) {
        return undefined;
      }
      return {
        type,
        path: uri.fsPath,
        relativePath,
      };
    };

    const createDisp = watcher.onDidCreate(uri => {
      const change = makeChange(uri, 'add');
      if (change) onChange(change);
    });
    const changeDisp = watcher.onDidChange(uri => {
      const change = makeChange(uri, 'change');
      if (change) onChange(change);
    });
    const deleteDisp = watcher.onDidDelete(uri => {
      const change = makeChange(uri, 'delete');
      if (change) onChange(change);
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

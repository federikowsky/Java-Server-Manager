import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as path from 'path';
import type { FileChange } from '@core/types/events';

const mocked = vi.hoisted(() => ({
  handlers: {} as Record<string, ((uri: { fsPath: string }) => void) | undefined>,
  createFileSystemWatcher: vi.fn(),
}));

vi.mock('vscode', () => ({
  RelativePattern: class {
    constructor(
      public readonly base: string,
      public readonly pattern: string,
    ) {}
  },
  workspace: {
    createFileSystemWatcher: mocked.createFileSystemWatcher,
  },
}));

const { FileWatcherAdapter } = await import('@ui/adapters/FileWatcherAdapter');

function makeWatcher() {
  return {
    onDidCreate: vi.fn((handler: (uri: { fsPath: string }) => void) => {
      mocked.handlers.create = handler;
      return { dispose: vi.fn() };
    }),
    onDidChange: vi.fn((handler: (uri: { fsPath: string }) => void) => {
      mocked.handlers.change = handler;
      return { dispose: vi.fn() };
    }),
    onDidDelete: vi.fn((handler: (uri: { fsPath: string }) => void) => {
      mocked.handlers.delete = handler;
      return { dispose: vi.fn() };
    }),
    dispose: vi.fn(),
  };
}

describe('FileWatcherAdapter', () => {
  beforeEach(() => {
    mocked.handlers = {};
    mocked.createFileSystemWatcher.mockReset();
    mocked.createFileSystemWatcher.mockReturnValue(makeWatcher());
  });

  it('does not emit tree changes whose relative path escapes the watched root', () => {
    const root = path.join(path.sep, 'workspace', 'app');
    const changes: FileChange[] = [];

    new FileWatcherAdapter().watch({ kind: 'tree', root, ignoreGlobs: [] }, change => changes.push(change));

    mocked.handlers.create?.({ fsPath: path.join(root, 'WEB-INF', 'web.xml') });
    mocked.handlers.change?.({ fsPath: path.join(root, '..', 'escape.txt') });

    expect(changes).toEqual([{
      type: 'add',
      path: path.join(root, 'WEB-INF', 'web.xml'),
      relativePath: path.join('WEB-INF', 'web.xml'),
    }]);
  });

  it('ignores single-file watcher events for unexpected sibling paths', () => {
    const filePath = path.join(path.sep, 'workspace', 'app.war');
    const changes: FileChange[] = [];

    new FileWatcherAdapter().watch({ kind: 'file', path: filePath }, change => changes.push(change));

    mocked.handlers.change?.({ fsPath: path.join(path.sep, 'workspace', 'other.war') });
    mocked.handlers.change?.({ fsPath: filePath });

    expect(changes).toEqual([{
      type: 'change',
      path: filePath,
      relativePath: 'app.war',
    }]);
  });
});

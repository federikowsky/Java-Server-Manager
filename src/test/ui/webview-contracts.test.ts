import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

function walkFiles(root: string, predicate: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      out.push(fullPath);
    }
  }
  return out.sort();
}

function commandIdsFromPackage(): string[] {
  const pkg = JSON.parse(read('package.json')) as {
    contributes?: {
      commands?: Array<{ command: string }>;
      menus?: Record<string, Array<{ command?: string }>>;
    };
  };
  return (pkg.contributes?.commands ?? [])
    .map(command => command.command)
    .sort();
}

function registeredCommandIds(): Set<string> {
  const sources = [
    'src/extension.ts',
    'src/ui/commands/server-commands.ts',
    'src/ui/commands/deployment-commands.ts',
  ].map(read).join('\n');
  return new Set([
    ...[...sources.matchAll(/registerCommand\(['"]([^'"]+)['"]/g)].map(match => match[1]),
    ...[...sources.matchAll(/\[\s*['"]([^'"]+)['"]\s*,/g)].map(match => match[1]),
  ]);
}

function manifestMenuCommandIds(): string[] {
  const pkg = JSON.parse(read('package.json')) as {
    contributes?: {
      menus?: Record<string, Array<{ command?: string }>>;
    };
  };
  return Object.values(pkg.contributes?.menus ?? {})
    .flat()
    .map(item => item.command)
    .filter((command): command is string => typeof command === 'string')
    .sort();
}

function dashboardAllowlistedCommandIds(): Set<string> {
  const src = read('src/ui/webviews/panels/DashboardPanel.ts');
  return new Set([...src.matchAll(/case ['"](jsm\.[^'"]+)['"]:/g)].map(match => match[1]));
}

function dashboardInternalHandlerIds(): Set<string> {
  const src = read('src/ui/webviews/panels/DashboardPanel.ts');
  return new Set([...src.matchAll(/msg\.id === ['"](jsm\.[^'"]+)['"]/g)].map(match => match[1]));
}

function clientExecuteCommandIds(): Set<string> {
  const files = walkFiles('src/ui/webviews/client', file => file.endsWith('.svelte') || file.endsWith('.ts'));
  const ids = new Set<string>();
  const patterns = [
    /id:\s*['"](jsm\.[^'"]+)['"]/g,
    /sendExecuteCommand\(\s*['"](jsm\.[^'"]+)['"]/g,
    /handleAction\(\s*['"](jsm\.[^'"]+)['"]/g,
    /handleNoArgAction\(\s*['"](jsm\.[^'"]+)['"]/g,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        ids.add(match[1]);
      }
    }
  }
  return ids;
}

function declaredIconNames(): Set<string> {
  const src = read('src/ui/webviews/client/components/Icon.svelte');
  return new Set([
    ...[...src.matchAll(/\| ['"]([^'"]+)['"]/g)].map(match => match[1]),
    ...[...src.matchAll(/['"]([^'"]+)['"]:\s*['"]</g)].map(match => match[1]),
  ]);
}

function clientIconUsages(): Array<{ name: string; file: string; line: number }> {
  const files = walkFiles('src/ui/webviews/client', file => file.endsWith('.svelte'));
  const usages: Array<{ name: string; file: string; line: number }> = [];
  const patterns = [
    /<Icon\s+[^>]*name=['"]([^'"]+)['"]/g,
    /\bicon:\s*['"]([^'"]+)['"]/g,
    /\bicon=['"]([^'"]+)['"]/g,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const name = match[1];
        if (!name || name.includes('{')) {
          continue;
        }
        usages.push({
          name,
          file,
          line: text.slice(0, match.index).split('\n').length,
        });
      }
    }
  }
  return usages;
}

describe('webview and manifest contracts', () => {
  it('registers every command contributed in package.json', () => {
    const registered = registeredCommandIds();
    const missing = commandIdsFromPackage().filter(command => !registered.has(command));

    expect(missing).toEqual([]);
  });

  it('keeps manifest menu commands declared in contributes.commands', () => {
    const contributed = new Set(commandIdsFromPackage());
    const undeclaredMenuCommands = manifestMenuCommandIds()
      .filter(command => !contributed.has(command));

    expect(undeclaredMenuCommands).toEqual([]);
  });

  it('allowlists every executeCommand id emitted by the dashboard client', () => {
    const allowlisted = dashboardAllowlistedCommandIds();
    const missing = [...clientExecuteCommandIds()]
      .filter(command => !allowlisted.has(command))
      .sort();

    expect(missing).toEqual([]);
  });

  it('does not allow dashboard commands that lack a handler or VS Code command registration', () => {
    const registered = registeredCommandIds();
    const internal = dashboardInternalHandlerIds();
    const unhandled = [...dashboardAllowlistedCommandIds()]
      .filter(command => !registered.has(command) && !internal.has(command))
      .sort();

    expect(unhandled).toEqual([]);
  });

  it('uses only declared icons in webview components', () => {
    const declared = declaredIconNames();
    const missing = clientIconUsages()
      .filter(usage => !declared.has(usage.name))
      .map(usage => `${usage.name} at ${usage.file}:${usage.line}`)
      .sort();

    expect(missing).toEqual([]);
  });
});

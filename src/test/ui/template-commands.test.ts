import { describe, it, expect, vi, beforeEach } from 'vitest';

const registeredHandlers: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn((id: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers[id] = handler;
      return { dispose: vi.fn() };
    }),
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class {
    constructor(public label: string, public collapsibleState: number) {}
  },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  MarkdownString: class {
    isTrusted = false;
    appendMarkdown() { return this; }
  },
}));

const { registerTemplateCommands } = await import('@ui/commands/template-commands');

describe('Template Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(registeredHandlers).forEach(key => delete registeredHandlers[key]);
  });

  it('opens the template manager panel', () => {
    const templateManagerPanel = { open: vi.fn() };

    registerTemplateCommands({ templateManagerPanel } as never);
    registeredHandlers['jsm.templates.manage']();

    expect(templateManagerPanel.open).toHaveBeenCalledOnce();
  });
});
import { describe, it, expect } from 'vitest';

const { registerTemplateCommands } = await import('@ui/commands/template-commands');

describe('Template Commands', () => {
  it('does not register any commands', () => {
    const disposables = registerTemplateCommands();
    expect(disposables).toEqual([]);
  });
});

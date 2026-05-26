import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('ServerWizard environment profile binding', () => {
  it('exposes environment profiles as explicit server run metadata', () => {
    const src = readSource('src/ui/webviews/client/components/spa/forms/ServerWizard.svelte');

    expect(src).toContain('environmentProfiles');
    expect(src).toContain('selectedEnvProfileId');
    expect(src).toContain('run.envProfileId');
    expect(src).toContain('Environment Profile');
    expect(src).toContain('snapshotServerWizardDraft');
    expect(src).toContain('restoreServerWizardDraft');
  });
});

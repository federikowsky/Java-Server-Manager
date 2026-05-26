import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('deployment wizard readiness gate authoring', () => {
  it('exposes explicit readiness gate controls and preserves them in the draft snapshot', () => {
    const src = readSource('src/ui/webviews/client/components/spa/forms/DeploymentWizard.svelte');

    expect(src).toContain('readinessGateEnabled');
    expect(src).toContain('readinessGateTrigger');
    expect(src).toContain('Require healthy response');
    expect(src).toContain('readinessGate: currentReadinessGateConfig()');
    expect(src).toContain('readinessGate: snapshotReadinessGateConfig()');
  });
});

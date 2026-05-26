import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('server detail operation timeline', () => {
  it('renders operation timeline evidence from operation history entries', () => {
    const src = readSource('src/ui/webviews/client/components/spa/ServerDetail.svelte');

    expect(src).toContain('operationTimeline(operation)');
    expect(src).toContain('operation-timeline');
    expect(src).toContain('timeline-step');
    expect(src).toContain('timelineStepClass(step.status)');
    expect(src).toContain('step.errorMessage');
  });

  it('exposes the Server Doctor command from server detail actions', () => {
    const src = readSource('src/ui/webviews/client/components/spa/ServerDetail.svelte');

    expect(src).toContain("handleAction('jsm.server.doctor')");
    expect(src).toContain('Doctor');
  });

  it('exposes explicit Lifecycle Recovery from server detail actions', () => {
    const src = readSource('src/ui/webviews/client/components/spa/ServerDetail.svelte');

    expect(src).toContain("handleAction('jsm.server.recover')");
    expect(src).toContain('Recover');
  });
});

import { describe, expect, it } from 'vitest';
import { buildOnboardingSteps } from '@ui/webviews/client/onboarding';

describe('dashboard onboarding steps', () => {
  it('blocks side-effecting steps in untrusted workspaces', () => {
    const steps = buildOnboardingSteps({
      workspaceTrusted: false,
      servers: [],
    });

    expect(steps.map(step => [step.id, step.status])).toEqual([
      ['trust', 'blocked'],
      ['java', 'available'],
      ['server', 'blocked'],
      ['deployment', 'blocked'],
    ]);
  });

  it('marks Java, server, and deployment progress from synced state', () => {
    const steps = buildOnboardingSteps({
      workspaceTrusted: true,
      settings: {
        defaultJavaHome: '/jdk',
        defaultHttpPort: 8080,
        defaultDebugPort: 5005,
        showStatusInSidebar: true,
      },
      servers: [{
        serverKey: 'ws::srv-1',
        workspaceFolderUri: 'ws',
        workspaceFolderName: 'ws',
        config: {
          deployments: [{ id: 'dep-1' }],
        },
      }],
    });

    expect(steps.every(step => step.status === 'complete')).toBe(true);
  });
});

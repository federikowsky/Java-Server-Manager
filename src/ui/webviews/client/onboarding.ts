import type { SpaServerRecord, SpaSettings } from '../protocol';

export type OnboardingStepId = 'trust' | 'java' | 'server' | 'deployment';
export type OnboardingAction = 'none' | 'settings' | 'add-server' | 'add-deployment';

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  status: 'complete' | 'available' | 'blocked';
  action: OnboardingAction;
}

export function buildOnboardingSteps(state: {
  workspaceTrusted: boolean;
  settings?: SpaSettings;
  servers: SpaServerRecord[];
}): OnboardingStep[] {
  const trusted = state.workspaceTrusted !== false;
  const hasJavaDefault = Boolean(state.settings?.defaultJavaHome?.trim());
  const hasServer = state.servers.length > 0;
  const hasDeployment = state.servers.some(record => {
    const config = record.config as { deployments?: unknown[] } | undefined;
    return (config?.deployments?.length ?? 0) > 0;
  });

  return [
    {
      id: 'trust',
      label: 'Workspace trust',
      status: trusted ? 'complete' : 'blocked',
      action: 'none',
    },
    {
      id: 'java',
      label: 'Java home',
      status: hasJavaDefault ? 'complete' : 'available',
      action: 'settings',
    },
    {
      id: 'server',
      label: 'Tomcat server',
      status: hasServer ? 'complete' : (trusted ? 'available' : 'blocked'),
      action: 'add-server',
    },
    {
      id: 'deployment',
      label: 'Deployment',
      status: hasDeployment ? 'complete' : (trusted && hasServer ? 'available' : 'blocked'),
      action: 'add-deployment',
    },
  ];
}

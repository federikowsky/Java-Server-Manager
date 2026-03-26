import { describe, it, expect } from 'vitest';
import { normalizeDashboardNavigationTarget } from '@ui/webviews/dashboardNavigation';

describe('normalizeDashboardNavigationTarget', () => {
  it('defaults type welcome and globalTab home', () => {
    expect(normalizeDashboardNavigationTarget(undefined)).toMatchObject({
      type: 'welcome',
      globalTab: 'home',
    });
  });

  it('maps settings type to globalTab settings', () => {
    expect(normalizeDashboardNavigationTarget({ type: 'settings' })).toMatchObject({
      type: 'settings',
      globalTab: 'settings',
    });
  });

  it('maps template types to templates tab when globalTab omitted', () => {
    expect(normalizeDashboardNavigationTarget({ type: 'template' })).toMatchObject({
      type: 'template',
      globalTab: 'templates',
    });
    expect(normalizeDashboardNavigationTarget({ type: 'new-template' })).toMatchObject({
      type: 'new-template',
      globalTab: 'templates',
    });
  });

  it('preserves explicit globalTab for template types', () => {
    expect(
      normalizeDashboardNavigationTarget({ type: 'template', globalTab: 'home' }),
    ).toMatchObject({ type: 'template', globalTab: 'home' });
  });

  it('defaults non-settings non-template targets to home tab', () => {
    expect(normalizeDashboardNavigationTarget({ type: 'server', id: 's1' })).toMatchObject({
      type: 'server',
      id: 's1',
      globalTab: 'home',
    });
    expect(
      normalizeDashboardNavigationTarget({
        type: 'deployment',
        serverId: 'sk',
        id: 'd1',
        mode: 'edit',
      }),
    ).toMatchObject({ globalTab: 'home' });
  });
});

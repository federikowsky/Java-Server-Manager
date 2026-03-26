/**
 * Normalizes dashboard navigation payloads from commands and tree (host + protocol contract).
 * See docs/jsm-webview-tree-primary.plan.md §5.2–§6.
 */

import type { DashboardNavigationTarget } from './protocol';

export function normalizeDashboardNavigationTarget(
  raw: Partial<DashboardNavigationTarget> | undefined,
): DashboardNavigationTarget {
  const type = raw?.type ?? 'welcome';
  let globalTab = raw?.globalTab;

  if (type === 'settings') {
    globalTab = 'settings';
  } else if (type === 'template' || type === 'new-template') {
    globalTab = globalTab ?? 'templates';
  } else {
    globalTab = globalTab ?? 'home';
  }

  return {
    ...raw,
    type,
    globalTab,
  } as DashboardNavigationTarget;
}

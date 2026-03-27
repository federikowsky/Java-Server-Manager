import type { ServerConfig, DeploymentConfig } from '@core/types';

/**
 * Describes what the autosync layer should observe on disk.
 * Resolved from deployment config — single place for war vs exploded watch shape.
 */
export type WatchSpec =
  | { kind: 'tree'; root: string; ignoreGlobs: string[] }
  | { kind: 'file'; path: string };

/**
 * Returns the watch spec for a deployment when autosync should observe it, or `undefined`.
 * Caller still enforces server-level `autosync.enabled`, trust, and watcher caps.
 */
export function resolveAutosyncWatchSpec(
  config: ServerConfig,
  dep: DeploymentConfig,
): WatchSpec | undefined {
  if (dep.syncMode !== 'auto') {
    return undefined;
  }
  switch (dep.type) {
    case 'exploded':
      return {
        kind: 'tree',
        root: dep.sourcePath,
        ignoreGlobs: [...config.autosync.ignoreGlobs, ...dep.ignoreGlobs],
      };
    case 'war':
      return { kind: 'file', path: dep.sourcePath };
  }
}

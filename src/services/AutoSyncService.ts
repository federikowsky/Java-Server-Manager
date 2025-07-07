/*
 * src/services/AutoSyncService.ts
 * Watches deployments flagged with autoSync. Uses chokidar and triggers
 * DeploymentService.publishIncremental with debounce.
 */

import chokidar, { FSWatcher } from 'chokidar';
import debounce from 'lodash.debounce';

import { AUTOSYNC_DEBOUNCE_MS } from '../constants';
import { DeploymentService } from './DeploymentService';
import { Result, ok, err } from '../core/utils/result';
import { JsmError } from '../core/errors/JsmError';
import { ErrorCode } from '../core/errors/codes';
import { Logger } from '../core/utils/logger';

export class AutoSyncService {
  private readonly log = Logger.getInstance().createChild('AutoSync');

  /** key = `${serverId}:${depId}` */
  private readonly map = new Map<string, FSWatcher>();

  constructor(private readonly depSvc: DeploymentService) {}

  /**
   * Enable/disable autosync on a deployment.
   * Returns `enabled` if a watcher is created, `disabled` if removed.
   */
  async toggle(serverId: string, depId: string): Promise<Result<'enabled' | 'disabled', JsmError>> {
    const key = this.composeKey(serverId, depId);

    // Disable
    const existing = this.map.get(key);
    if (existing) {
      existing.close();
      this.map.delete(key);
      this.log.info(`AutoSync OFF ${key}`);
      return ok('disabled');
    }

    // Enable
    const depResult = await this.depSvc.getDeployment(serverId, depId);
    if (!depResult.ok) return depResult as any;

    const { sourcePath, ignoreGlobs = [] } = depResult.value;

    try {
      const watcher = chokidar.watch(sourcePath, {
        ignoreInitial: true,
        ignored: ignoreGlobs
      });

      const publish = () => {
        this.depSvc.publish(serverId, depId, 'incremental').then(r => {
          if (!r.ok) this.log.error(`AutoSync publish failed`, r.error);
        });
      };

      const debounced = debounce(publish, AUTOSYNC_DEBOUNCE_MS, { leading: false, trailing: true });

      watcher.on('add', debounced)
              .on('change', debounced)
              .on('unlink', debounced);

      this.map.set(key, watcher);
      this.log.info(`AutoSync ON ${key}`);
      return ok('enabled');
    } catch (e) {
      return err(new JsmError(ErrorCode.AUTOSYNC_TOGGLE_ERROR, 'Unable to create watcher', e));
    }
  }

  /**
   * Check if AutoSync is enabled for a deployment
   */
  isEnabled(serverId: string, depId: string): boolean {
    const key = this.composeKey(serverId, depId);
    return this.map.has(key);
  }

  disposeAll(): void {
    for (const w of this.map.values()) w.close();
    this.map.clear();
    this.log.debug('All AutoSync watchers disposed');
  }

  private composeKey(s: string, d: string) { return `${s}:${d}`; }
}

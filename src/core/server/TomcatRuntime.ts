/*
 * src/core/server/TomcatRuntime.ts
 * Concrete implementation for Apache Tomcat.
 */

import * as path from 'path';
import { ServerConfig, DeploymentConfig } from '../types/domain';
import { AbstractRuntime } from './AbstractRuntime';
import { Result, ok } from '../utils/result';
import { JsmError } from '../errors/JsmError';

export class TomcatRuntime extends AbstractRuntime {
  protected buildLaunchCommand(mode: 'run' | 'debug', jdwpPort?: number): { cmd: string; args: string[]; env?: Record<string, string>; } {
    throw new Error('Method not implemented.');
  }
  constructor(cfg: ServerConfig) { super(cfg); }

  protected buildStartCommand(mode: 'run' | 'debug', port?: number) {
    const catalina = path.join(this.cfg.serverHome, 'bin', process.platform === 'win32' ? 'catalina.bat' : 'catalina.sh');
    const args = [mode === 'debug' ? 'jpda' : '', 'start'].filter(Boolean);
    if (mode === 'debug' && port) {
      process.env['JPDA_ADDRESS'] = String(port);
      process.env['JPDA_TRANSPORT'] = 'dt_socket';
    }
    return { cmd: catalina, args };
  }

  protected async doPublish(dep: DeploymentConfig, mode: 'incremental' | 'full'): Promise<Result<void, JsmError>> {
    // Simplified: copy directory/file to webapps
    const targetName = dep.renameTo ?? path.basename(dep.targetPath);
    const dest = path.join(this.cfg.serverHome, 'webapps', targetName);
    // TODO: implement real copy logic (fs-extra)
    return ok(undefined);
  }

  protected async doUndeploy(dep: DeploymentConfig, soft: boolean): Promise<Result<void, JsmError>> {
    // Simplified: remove dir/file
    return ok(undefined);
  }
}

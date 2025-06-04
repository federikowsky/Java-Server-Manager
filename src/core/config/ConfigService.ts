/*
 * src/core/config/ConfigService.ts
 * CRUD on .vscode/servers.json in workspace.
 */

import { Uri, workspace } from 'vscode';
import * as path from 'path';
import { err, ok, Result } from '../utils/result';
import { JSM_SERVER_CONFIG_FILENAME } from '../../constants';
import { ServerConfig, DeploymentConfig, WorkspaceServersConfig } from '../types/domain';
import { ConfigValidator } from './ConfigValidator';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Logger } from '../utils/logger';

export class ConfigService {
  private readonly wsFile: string;
  private readonly validator = new ConfigValidator();
  private readonly logger = Logger.getInstance().createChild('Config');

  constructor(private workspaceUri: Uri) {
    this.wsFile = path.join(workspaceUri.fsPath, '.vscode', JSM_SERVER_CONFIG_FILENAME);
  }

  loadAll(): Result<ServerConfig[], JsmError> {
    try {
      const data = require('fs').readFileSync(this.wsFile, 'utf8');
      const json = JSON.parse(data);
      const v = this.validator.validate(json);
      if (!v.ok) return err(v.error);
      return ok((json as WorkspaceServersConfig).servers);
    } catch (e: any) {
      if (e.code === 'ENOENT') return ok([]); // fresh workspace
      return err(new JsmError(ErrorCode.FS_READ, 'Unable to read servers.json', e));
    }
  }

  upsertServer(cfg: ServerConfig): Result<void, JsmError> {
    const allRes = this.loadAll();
    if (!allRes.ok) return allRes;
    const list = allRes.value;
    const idx = list.findIndex(s => s.id === cfg.id);
    if (idx === -1) list.push(cfg); else list[idx] = cfg;
    return this.saveAll(list);
  }

  deleteServer(id: string): Result<void, JsmError> {
    const allRes = this.loadAll();
    if (!allRes.ok) return allRes;
    const filtered = allRes.value.filter(s => s.id !== id);
    return this.saveAll(filtered);
  }

  upsertDeployment(serverId: string, dep: DeploymentConfig): Result<void, JsmError> {
    const allRes = this.loadAll();
    if (!allRes.ok) return allRes;
    const list = allRes.value;
    const server = list.find(s => s.id === serverId);
    if (!server) return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, 'Server not found'));
    const i = server.deployments.findIndex(d => d.id === dep.id);
    if (i === -1) server.deployments.push(dep); else server.deployments[i] = dep;
    return this.saveAll(list);
  }

  deleteDeployment(serverId: string, depId: string): Result<void, JsmError> {
    const allRes = this.loadAll();
    if (!allRes.ok) return allRes;
    const list = allRes.value;
    const server = list.find(s => s.id === serverId);
    if (!server) return err(new JsmError(ErrorCode.SERVER_NOT_FOUND, 'Server not found'));
    server.deployments = server.deployments.filter(d => d.id !== depId);
    return this.saveAll(list);
  }

  private saveAll(list: ServerConfig[]): Result<void, JsmError> {
    const json: WorkspaceServersConfig = { servers: list };
    const verify = this.validator.validate(json);
    if (!verify.ok) return err(verify.error);
    try {
      require('fs').mkdirSync(path.dirname(this.wsFile), { recursive: true });
      require('fs').writeFileSync(this.wsFile, JSON.stringify(json, null, 2), 'utf8');
      return ok(undefined);
    } catch (e) {
      return err(new JsmError(ErrorCode.FS_WRITE, 'Unable to write servers.json', e));
    }
  }
}

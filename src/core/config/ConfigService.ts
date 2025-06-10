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
    console.log('📁 ConfigService: Workspace URI:', workspaceUri.fsPath);
    console.log('📁 ConfigService: Looking for servers.json at:', this.wsFile);
  }

  loadAll(): Result<ServerConfig[], JsmError> {
    console.log('📖 ConfigService: Attempting to read servers.json from:', this.wsFile);
    try {
      const data = require('fs').readFileSync(this.wsFile, 'utf8');
      console.log('✅ ConfigService: Successfully read servers.json, length:', data.length);
      const json = JSON.parse(data);
      console.log('✅ ConfigService: Successfully parsed JSON, servers count:', json.servers?.length || 0);
      const v = this.validator.validate(json);
      if (!v.ok) {
        console.error('❌ ConfigService: Validation failed:', v.error);
        return err(v.error);
      }
      console.log('✅ ConfigService: Validation passed, returning', json.servers.length, 'servers');
      return ok((json as WorkspaceServersConfig).servers);
    } catch (e: any) {
      console.log('⚠️ ConfigService: Error reading servers.json:', e.code, e.message);
      if (e.code === 'ENOENT') {
        console.log('📝 ConfigService: servers.json not found, returning empty array (fresh workspace)');
        return ok([]); // fresh workspace
      }
      console.error('❌ ConfigService: Unexpected error:', e);
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

/*
 * src/core/config/GlobalTemplateManager.ts
 * Persist user‑wide server templates in extension globalStorage.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ServerTemplate, ServerConfig } from '../types/domain';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { Result, ok, err } from '../utils/result';
import { ConfigValidator } from './ConfigValidator';
import { Logger } from '../utils/logger';
import { JSM_GLOBAL_TEMPLATES_FILENAME } from '../../constants';

export class GlobalTemplateManager {
  private readonly file: string;
  private readonly validator = new ConfigValidator();
  private readonly log = Logger.getInstance().createChild('Tpl');

  constructor(private storageDir: string) {
    this.file = path.join(storageDir, JSM_GLOBAL_TEMPLATES_FILENAME);
  }

  list(): Result<ServerTemplate[], JsmError> {
    const cfg = this.readFile();
    return cfg.ok ? ok(cfg.value.templates) : err(cfg.error);
  }

  get(id: string): Result<ServerTemplate, JsmError> {
    const list = this.list();
    if (!list.ok) return list as any;
    const tpl = list.value.find(t => t.id === id);
    return tpl ? ok(tpl) : err(new JsmError(ErrorCode.TEMPLATE_NOT_FOUND, 'Template not found'));
  }

  save(draft: ServerTemplate): Result<void, JsmError> {
    const list = this.list();
    if (!list.ok) return list as any;
    if (list.value.some(t => t.id === draft.id)) {
      return err(new JsmError(ErrorCode.TEMPLATE_DUPLICATE, 'Duplicate template id'));
    }
    list.value.push(draft);
    return this.writeFile({ templates: list.value });
  }

  update(id: string, draft: ServerTemplate): Result<void, JsmError> {
    const list = this.list();
    if (!list.ok) return list as any;
    const idx = list.value.findIndex(t => t.id === id);
    if (idx === -1) return err(new JsmError(ErrorCode.TEMPLATE_NOT_FOUND, 'Template not found'));
    list.value[idx] = draft;
    return this.writeFile({ templates: list.value });
  }

  delete(id: string): Result<void, JsmError> {
    const list = this.list();
    if (!list.ok) return list as any;
    const filtered = list.value.filter(t => t.id !== id);
    return this.writeFile({ templates: filtered });
  }

  clone(tpl: ServerTemplate, workspace: string): ServerConfig {
    const { id: _id, description: _d, ...rest } = tpl;
    return {
      ...rest.defaultConfig,
      id: crypto.randomUUID(),
      name: tpl.name,
      deployments: [],
      state: 'stopped',
      pidFile: path.join(workspace, rest.defaultConfig?.name ?? tpl.name + '.pid')
    } as unknown as ServerConfig; // caller must refine
  }

  /* — private helpers — */
  private readFile(): Result<{ templates: ServerTemplate[] }, JsmError> {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const json = JSON.parse(raw);
      // schema reuse (optional)
      return ok(json);
    } catch (e: any) {
      if (e.code === 'ENOENT') return ok({ templates: [] });
      return err(new JsmError(ErrorCode.FS_READ, 'Cannot read templates file', e));
    }
  }

  private writeFile(obj: { templates: ServerTemplate[] }): Result<void, JsmError> {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(obj, null, 2), 'utf8');
      return ok(undefined);
    } catch (e) {
      return err(new JsmError(ErrorCode.FS_WRITE, 'Cannot write templates file', e));
    }
  }
}

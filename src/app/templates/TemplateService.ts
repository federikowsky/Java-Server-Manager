import type {
  ServerTemplate,
  TemplateId,
  Logger,
} from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { KeyValueStore } from '@core/types/runtime';

const GLOBAL_TEMPLATES_KEY = 'jsm.templates.global';
const WORKSPACE_TEMPLATES_KEY = 'jsm.templates.workspace';

/**
 * Template service (§5.5).
 * Manages global and workspace-scoped server templates.
 * Global templates persist in VS Code global storage; workspace templates persist per-workspace.
 */
export class TemplateService {
  private readonly globalStore: KeyValueStore;
  private readonly workspaceStore: KeyValueStore;
  private readonly logger: Logger;

  constructor(deps: {
    globalStore: KeyValueStore;
    workspaceStore: KeyValueStore;
    logger: Logger;
  }) {
    this.globalStore = deps.globalStore;
    this.workspaceStore = deps.workspaceStore;
    this.logger = deps.logger;
  }

  // ── Read ──────────────────────────────────────────────────────────

  /** Get all templates (global + workspace, workspace wins on id collision). */
  getAll(): ServerTemplate[] {
    const global = this.globalStore.get<ServerTemplate[]>(GLOBAL_TEMPLATES_KEY) ?? [];
    const workspace = this.workspaceStore.get<ServerTemplate[]>(WORKSPACE_TEMPLATES_KEY) ?? [];

    // Workspace overrides global on same id
    const map = new Map<TemplateId, ServerTemplate>();
    for (const t of global) map.set(t.id, t);
    for (const t of workspace) map.set(t.id, t);
    return [...map.values()];
  }

  /** Get a template by ID. Checks workspace first, then global. */
  get(id: TemplateId): ServerTemplate | undefined {
    const workspace = this.workspaceStore.get<ServerTemplate[]>(WORKSPACE_TEMPLATES_KEY) ?? [];
    const found = workspace.find(t => t.id === id);
    if (found) return found;

    const global = this.globalStore.get<ServerTemplate[]>(GLOBAL_TEMPLATES_KEY) ?? [];
    return global.find(t => t.id === id);
  }

  // ── Write ─────────────────────────────────────────────────────────

  /** Save a template to the specified scope. */
  async save(
    template: ServerTemplate,
    scope: 'global' | 'workspace',
  ): Promise<Result<void, JsmError>> {
    const store = scope === 'global' ? this.globalStore : this.workspaceStore;
    const key = scope === 'global' ? GLOBAL_TEMPLATES_KEY : WORKSPACE_TEMPLATES_KEY;

    try {
      const existing = store.get<ServerTemplate[]>(key) ?? [];
      const idx = existing.findIndex(t => t.id === template.id);
      if (idx >= 0) {
        existing[idx] = template;
      } else {
        existing.push(template);
      }
      await store.set(key, existing);
      this.logger.info(`TemplateService: saved template '${template.name}' to ${scope}`);
      return ok(undefined);
    } catch (cause) {
      return err(cause instanceof JsmError ? cause : JsmError.fromUnknown(cause));
    }
  }

  /** Delete a template from the specified scope. */
  async delete(
    id: TemplateId,
    scope: 'global' | 'workspace',
  ): Promise<Result<void, JsmError>> {
    const store = scope === 'global' ? this.globalStore : this.workspaceStore;
    const key = scope === 'global' ? GLOBAL_TEMPLATES_KEY : WORKSPACE_TEMPLATES_KEY;

    try {
      const existing = store.get<ServerTemplate[]>(key) ?? [];
      const filtered = existing.filter(t => t.id !== id);
      if (filtered.length === existing.length) {
        return err(new JsmError({
          code: ErrorCode.InvalidConfig,
          message: `Template '${id}' not found in ${scope} scope`,
        }));
      }
      await store.set(key, filtered);
      this.logger.info(`TemplateService: deleted template '${id}' from ${scope}`);
      return ok(undefined);
    } catch (cause) {
      return err(cause instanceof JsmError ? cause : JsmError.fromUnknown(cause));
    }
  }
}

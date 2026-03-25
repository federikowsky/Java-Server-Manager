import type {
  ServerTemplate,
  TemplateId,
  Logger,
} from '@core/types';
import type { Result } from '@core/result';
import { ok, err } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import type { KeyValueStore, TrustGate } from '@core/types/runtime';
import { requireWorkspaceTrust } from '@core/policy';

const GLOBAL_TEMPLATES_KEY = 'jsm.templates.global';
const WORKSPACE_TEMPLATES_KEY = 'jsm.templates.workspace';

export interface ScopedTemplateEntry {
  key: string;
  template: ServerTemplate;
  scope: 'global' | 'workspace';
}

/**
 * Template service (§5.5).
 * Manages global and workspace-scoped server templates.
 * Global templates persist in VS Code global storage; workspace templates persist per-workspace.
 */
export class TemplateService {
  private readonly globalStore: KeyValueStore;
  private readonly workspaceStore: KeyValueStore;
  private readonly logger: Logger;
  private readonly trustGate?: TrustGate;

  constructor(deps: {
    globalStore: KeyValueStore;
    workspaceStore: KeyValueStore;
    logger: Logger;
    trustGate?: TrustGate;
  }) {
    this.globalStore = deps.globalStore;
    this.workspaceStore = deps.workspaceStore;
    this.logger = deps.logger;
    this.trustGate = deps.trustGate;
  }

  // ── Read ──────────────────────────────────────────────────────────

  /** Get all templates (global + workspace, workspace wins on id collision). */
  getAll(): ServerTemplate[] {
    const global = this.getScoped('global');
    const workspace = this.getScoped('workspace');

    // Workspace overrides global on same id
    const map = new Map<TemplateId, ServerTemplate>();
    for (const t of global) map.set(t.id, t);
    for (const t of workspace) map.set(t.id, t);
    return [...map.values()];
  }

  /** Get a template by ID. Checks workspace first, then global. */
  get(id: TemplateId): ServerTemplate | undefined {
    const workspace = this.getScoped('workspace');
    const found = workspace.find(t => t.id === id);
    if (found) return found;

    const global = this.getScoped('global');
    return global.find(t => t.id === id);
  }

  /** Get all templates including their storage scope. */
  listScoped(): ScopedTemplateEntry[] {
    return [
      ...this.getScoped('workspace').map(template => ({
        key: `workspace:${template.id}`,
        template,
        scope: 'workspace' as const,
      })),
      ...this.getScoped('global').map(template => ({
        key: `global:${template.id}`,
        template,
        scope: 'global' as const,
      })),
    ];
  }

  cloneTemplate(args: {
    template: ServerTemplate;
    id: TemplateId;
    name: string;
  }): ServerTemplate {
    const { template, id, name } = args;
    return {
      ...structuredClone(template),
      id,
      name,
    };
  }

  // ── Write ─────────────────────────────────────────────────────────

  /** Save a template to the specified scope. */
  async save(
    template: ServerTemplate,
    scope: 'global' | 'workspace',
  ): Promise<Result<void, JsmError>> {
    const trustResult = requireWorkspaceTrust(this.trustGate, 'modify templates');
    if (!trustResult.ok) return trustResult;

    const targetStore = scope === 'global' ? this.globalStore : this.workspaceStore;
    const targetKey = scope === 'global' ? GLOBAL_TEMPLATES_KEY : WORKSPACE_TEMPLATES_KEY;
    const otherStore = scope === 'global' ? this.workspaceStore : this.globalStore;
    const otherKey = scope === 'global' ? WORKSPACE_TEMPLATES_KEY : GLOBAL_TEMPLATES_KEY;

    try {
      const existingTarget = targetStore.get<ServerTemplate[]>(targetKey) ?? [];
      const existingOther = otherStore.get<ServerTemplate[]>(otherKey) ?? [];

      const nextTarget = existingTarget.filter(item => item.id !== template.id);
      nextTarget.push(template);
      const nextOther = existingOther.filter(item => item.id !== template.id);

      await targetStore.set(targetKey, nextTarget);
      try {
        await otherStore.set(otherKey, nextOther);
      } catch (cause) {
        await targetStore.set(targetKey, existingTarget);
        throw cause;
      }

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
    const trustResult = requireWorkspaceTrust(this.trustGate, 'modify templates');
    if (!trustResult.ok) return trustResult;

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

  private getScoped(scope: 'global' | 'workspace'): ServerTemplate[] {
    const store = scope === 'global' ? this.globalStore : this.workspaceStore;
    const key = scope === 'global' ? GLOBAL_TEMPLATES_KEY : WORKSPACE_TEMPLATES_KEY;
    return store.get<ServerTemplate[]>(key) ?? [];
  }
}

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
import { normalizeHookList, validateHookList } from '@core/authoring';

const GLOBAL_TEMPLATES_KEY = 'jsm.templates.global';
const WORKSPACE_TEMPLATES_KEY = 'jsm.templates.workspace';
const GALLERY_TEMPLATE_ID_PREFIX = 'gallery.';
const SUPPORTED_TEMPLATE_PLUGIN_TYPES = new Set(['tomcat']);
const TEMPLATE_TOP_LEVEL_KEYS = new Set(['id', 'name', 'description', 'pluginType', 'serverDefaults']);
const TEMPLATE_DEFAULT_KEYS = new Set(['runtime', 'javaHome', 'host', 'ports', 'run', 'debug', 'hooks', 'pluginConfig']);
const TEMPLATE_RUNTIME_KEYS = new Set(['homePath']);
const TEMPLATE_PORT_KEYS = new Set(['http', 'debug']);
const TEMPLATE_RUN_KEYS = new Set(['vmArgs']);
const TEMPLATE_DEBUG_KEYS = new Set(['bind']);
const TOMCAT_PLUGIN_CONFIG_KEYS = new Set(['type', 'shutdownPort', 'disableAjp', 'ssl']);

export interface ScopedTemplateEntry {
  key: string;
  template: ServerTemplate;
  scope: 'global' | 'workspace' | 'gallery';
}

const BUILT_IN_GALLERY_TEMPLATES: readonly ServerTemplate[] = [
  {
    id: 'gallery.tomcat.local-dev',
    name: 'Tomcat Local Dev',
    description: 'Local Tomcat defaults for iterative development.',
    pluginType: 'tomcat',
    serverDefaults: {
      host: '127.0.0.1',
      ports: { http: 8080, debug: 5005 },
      run: { vmArgs: ['-Xms256m', '-Xmx1g'] },
      debug: { bind: '127.0.0.1' },
      hooks: [],
      pluginConfig: { type: 'tomcat', shutdownPort: 8005, disableAjp: true },
    },
  },
  {
    id: 'gallery.tomcat.alt-ports',
    name: 'Tomcat Alternate Ports',
    description: 'Tomcat preset for workspaces where 8080 is usually occupied.',
    pluginType: 'tomcat',
    serverDefaults: {
      host: '127.0.0.1',
      ports: { http: 8180, debug: 5105 },
      run: { vmArgs: ['-Xms256m', '-Xmx1g'] },
      debug: { bind: '127.0.0.1' },
      hooks: [],
      pluginConfig: { type: 'tomcat', shutdownPort: 8105, disableAjp: true },
    },
  },
  {
    id: 'gallery.tomcat.low-memory',
    name: 'Tomcat Low Memory',
    description: 'Conservative local Tomcat preset for small sample applications.',
    pluginType: 'tomcat',
    serverDefaults: {
      host: '127.0.0.1',
      ports: { http: 8080, debug: 5005 },
      run: { vmArgs: ['-Xms128m', '-Xmx512m'] },
      debug: { bind: '127.0.0.1' },
      hooks: [],
      pluginConfig: { type: 'tomcat', shutdownPort: 8005, disableAjp: true },
    },
  },
] as const;

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
    const gallery = this.getGallery();

    // Workspace overrides global on same id
    const map = new Map<TemplateId, ServerTemplate>();
    for (const t of global) map.set(t.id, t);
    for (const t of gallery) map.set(t.id, t);
    for (const t of workspace) map.set(t.id, t);
    return [...map.values()];
  }

  /** Get a template by ID. Checks workspace first, then global. */
  get(id: TemplateId): ServerTemplate | undefined {
    const workspace = this.getScoped('workspace');
    const found = workspace.find(t => t.id === id);
    if (found) return found;

    const global = this.getScoped('global');
    const globalFound = global.find(t => t.id === id);
    if (globalFound) return globalFound;

    return this.getGallery().find(t => t.id === id);
  }

  /** Get all templates including their storage scope. */
  listScoped(): ScopedTemplateEntry[] {
    return [
      ...this.getScoped('workspace').map(template => ({
        key: `workspace:${template.id}`,
        template,
        scope: 'workspace' as const,
      })),
      ...this.getGallery().map(template => ({
        key: `gallery:${template.id}`,
        template,
        scope: 'gallery' as const,
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
      const sanitizeResult = sanitizeTemplate(template);
      if (!sanitizeResult.ok) {
        return sanitizeResult;
      }
      const safeTemplate = sanitizeResult.value;
      const existingTarget = targetStore.get<ServerTemplate[]>(targetKey) ?? [];
      const existingOther = otherStore.get<ServerTemplate[]>(otherKey) ?? [];

      const nextTarget = existingTarget.filter(item => item.id !== safeTemplate.id);
      nextTarget.push(safeTemplate);
      const nextOther = existingOther.filter(item => item.id !== safeTemplate.id);

      await targetStore.set(targetKey, nextTarget);
      try {
        await otherStore.set(otherKey, nextOther);
      } catch (cause) {
        await targetStore.set(targetKey, existingTarget);
        throw cause;
      }

      this.logger.info(`TemplateService: saved template '${safeTemplate.name}' to ${scope}`);
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

  private getGallery(): ServerTemplate[] {
    return BUILT_IN_GALLERY_TEMPLATES.map(template => structuredClone(template));
  }
}

function sanitizeTemplate(template: ServerTemplate): Result<ServerTemplate, JsmError> {
  if (!isRecord(template)) {
    return invalidTemplate('Template must be an object');
  }

  const topLevelResult = rejectUnknownKeys(template, TEMPLATE_TOP_LEVEL_KEYS, 'template');
  if (!topLevelResult.ok) return topLevelResult;

  if (!isNonEmptyString(template.id)) {
    return invalidTemplate('Template id is required');
  }
  if (template.id.trim().startsWith(GALLERY_TEMPLATE_ID_PREFIX)) {
    return invalidTemplate(`Template ids starting with '${GALLERY_TEMPLATE_ID_PREFIX}' are reserved for built-in gallery presets`);
  }
  if (!isNonEmptyString(template.name)) {
    return invalidTemplate('Template name is required');
  }
  if (template.pluginType !== 'tomcat' || !SUPPORTED_TEMPLATE_PLUGIN_TYPES.has(template.pluginType)) {
    return invalidTemplate(`Unsupported template plugin type '${String(template.pluginType)}'`);
  }
  if (template.description !== undefined && typeof template.description !== 'string') {
    return invalidTemplate('Template description must be a string when provided');
  }

  const defaultsResult = sanitizeTemplateDefaults(template.serverDefaults ?? {}, template.pluginType);
  if (!defaultsResult.ok) return defaultsResult;

  return ok({
    id: template.id.trim(),
    name: template.name.trim(),
    pluginType: template.pluginType,
    ...(template.description?.trim() ? { description: template.description.trim() } : {}),
    serverDefaults: defaultsResult.value,
  });
}

function sanitizeTemplateDefaults(
  defaults: unknown,
  pluginType: ServerTemplate['pluginType'],
): Result<ServerTemplate['serverDefaults'], JsmError> {
  if (!isRecord(defaults)) {
    return invalidTemplate('Template serverDefaults must be an object');
  }

  const unknownResult = rejectUnknownKeys(defaults, TEMPLATE_DEFAULT_KEYS, 'template.serverDefaults');
  if (!unknownResult.ok) return unknownResult;

  const sanitized: ServerTemplate['serverDefaults'] = {};

  if (defaults['runtime'] !== undefined) {
    if (!isRecord(defaults['runtime'])) {
      return invalidTemplate('Template runtime defaults must be an object');
    }
    const runtimeResult = rejectUnknownKeys(defaults['runtime'], TEMPLATE_RUNTIME_KEYS, 'template.serverDefaults.runtime');
    if (!runtimeResult.ok) return runtimeResult;
    const homePath = optionalTrimmedString(defaults['runtime']['homePath']);
    if (homePath) {
      sanitized.runtime = { homePath };
    }
  }

  const javaHome = optionalTrimmedString(defaults['javaHome']);
  if (javaHome) sanitized.javaHome = javaHome;

  const host = optionalTrimmedString(defaults['host']);
  if (host) sanitized.host = host;

  if (defaults['ports'] !== undefined) {
    if (!isRecord(defaults['ports'])) {
      return invalidTemplate('Template port defaults must be an object');
    }
    const portsResult = rejectUnknownKeys(defaults['ports'], TEMPLATE_PORT_KEYS, 'template.serverDefaults.ports');
    if (!portsResult.ok) return portsResult;
    const httpPort = optionalPort(defaults['ports']['http'], 'template.serverDefaults.ports.http');
    if (!httpPort.ok) return httpPort;
    const debugPort = optionalPort(defaults['ports']['debug'], 'template.serverDefaults.ports.debug');
    if (!debugPort.ok) return debugPort;
    sanitized.ports = {
      ...(httpPort.value !== undefined ? { http: httpPort.value } : {}),
      ...(debugPort.value !== undefined ? { debug: debugPort.value } : {}),
    };
  }

  if (defaults['run'] !== undefined) {
    if (!isRecord(defaults['run'])) {
      return invalidTemplate('Template run defaults must be an object');
    }
    const runResult = rejectUnknownKeys(defaults['run'], TEMPLATE_RUN_KEYS, 'template.serverDefaults.run');
    if (!runResult.ok) return runResult;
    const vmArgs = stringList(defaults['run']['vmArgs']);
    if (vmArgs.length > 0) {
      sanitized.run = { vmArgs };
    }
  }

  if (defaults['debug'] !== undefined) {
    if (!isRecord(defaults['debug'])) {
      return invalidTemplate('Template debug defaults must be an object');
    }
    const debugResult = rejectUnknownKeys(defaults['debug'], TEMPLATE_DEBUG_KEYS, 'template.serverDefaults.debug');
    if (!debugResult.ok) return debugResult;
    const bind = optionalTrimmedString(defaults['debug']['bind']);
    if (bind !== undefined) {
      if (!['127.0.0.1', 'localhost', '::1'].includes(bind)) {
        return invalidTemplate('Template debug bind must be localhost-only');
      }
      sanitized.debug = { bind };
    }
  }

  const hookErrors = validateHookList(defaults['hooks'], 'template.serverDefaults.hooks');
  if (hookErrors.length > 0) {
    return invalidTemplate(
      'Template hooks are invalid',
      hookErrors.map(error => `${error.field}: ${error.message}`).join('; '),
    );
  }
  const hooks = normalizeHookList(defaults['hooks']);
  if (hooks.length > 0) {
    sanitized.hooks = hooks;
  }

  if (defaults['pluginConfig'] !== undefined) {
    const pluginConfigResult = sanitizePluginConfig(defaults['pluginConfig'], pluginType);
    if (!pluginConfigResult.ok) return pluginConfigResult;
    sanitized.pluginConfig = pluginConfigResult.value;
  }

  return ok(sanitized);
}

function sanitizePluginConfig(
  value: unknown,
  pluginType: ServerTemplate['pluginType'],
): Result<ServerTemplate['serverDefaults']['pluginConfig'], JsmError> {
  if (!isRecord(value)) {
    return invalidTemplate('Template pluginConfig must be an object');
  }
  if (pluginType !== 'tomcat' || value['type'] !== 'tomcat') {
    return invalidTemplate('Template pluginConfig type must match the template plugin type');
  }

  const unknownResult = rejectUnknownKeys(value, TOMCAT_PLUGIN_CONFIG_KEYS, 'template.serverDefaults.pluginConfig');
  if (!unknownResult.ok) return unknownResult;

  if (!Number.isInteger(value['shutdownPort'])
    || typeof value['shutdownPort'] !== 'number'
    || value['shutdownPort'] < 1
    || value['shutdownPort'] > 65535) {
    return invalidTemplate('Template Tomcat shutdownPort must be an integer between 1 and 65535');
  }
  if (typeof value['disableAjp'] !== 'boolean') {
    return invalidTemplate('Template Tomcat disableAjp must be a boolean');
  }
  if (value['ssl'] !== undefined && !isRecord(value['ssl'])) {
    return invalidTemplate('Template Tomcat ssl defaults must be an object');
  }

  return ok({
    type: 'tomcat',
    shutdownPort: value['shutdownPort'],
    disableAjp: value['disableAjp'],
    ...(value['ssl'] !== undefined ? { ssl: structuredClone(value['ssl']) as never } : {}),
  });
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): Result<void, JsmError> {
  const rejected = Object.keys(value).filter(key => !allowed.has(key));
  if (rejected.length === 0) {
    return ok(undefined);
  }

  return invalidTemplate(`${label} contains unsupported field(s): ${rejected.join(', ')}`);
}

function invalidTemplate(message: string, details?: string): Result<never, JsmError> {
  return err(new JsmError({
    code: ErrorCode.InvalidConfig,
    message,
    details,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalPort(value: unknown, label: string): Result<number | undefined, JsmError> {
  if (value === undefined || value === null || value === '') return ok(undefined);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535) {
    return ok(value);
  }
  return invalidTemplate(`${label} must be an integer between 1 and 65535`);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(Boolean);
}

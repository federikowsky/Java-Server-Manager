import { v4 as uuidv4 } from 'uuid';
import type { ServerConfig, DeploymentConfig, HookConfig, PluginConfig } from '../types';
import type { Result } from '../result';
import { ok, err } from '../result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { SCHEMA_VERSION } from '../../constants';

// ── Workspace Config Shape ──────────────────────────────────────────────────

export interface WorkspaceConfig {
  schemaVersion: number;
  servers: ServerConfig[];
}

// ── Default Values ──────────────────────────────────────────────────────────

export const DEFAULT_AUTOSYNC_IGNORE_GLOBS: readonly string[] = [
  '**/.git/**',
  '**/node_modules/**',
  '**/target/**',
  '**/build/**',
  '**/.gradle/**',
  '**/.idea/**',
  '**/.classpath',
  '**/.project',
  '*.tmp',
  '*.log',
  '*.swp',
];

const DEFAULT_HOOK_TIMEOUT_MS = 60_000;

// ── Shell-Split Utility ─────────────────────────────────────────────────────

/** Split a string by whitespace, respecting single/double quotes. */
export function shellSplit(str: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of str) {
    if (quote) {
      if (ch === quote) { quote = null; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// ── V0 → V1 Migration (§4.7) ───────────────────────────────────────────────

interface LegacyServerRaw {
  id?: string;
  name?: string;
  type?: string;
  serverHome?: string;
  homePath?: string;
  port?: number;
  javaHome?: string;
  host?: string;
  vmArgs?: string | string[];
  autoSync?: boolean;
  preStartCmd?: string;
  postStopCmd?: string;
  instancePath?: string;
  deployments?: unknown[];
  [key: string]: unknown;
}

const KNOWN_V0_KEYS = new Set([
  'id', 'name', 'type', 'serverHome', 'homePath', 'port', 'javaHome',
  'host', 'vmArgs', 'autoSync', 'preStartCmd', 'postStopCmd',
  'instancePath', 'deployments',
]);

function migrateHooksFromLegacy(raw: LegacyServerRaw): HookConfig[] {
  const hooks: HookConfig[] = [];
  if (raw.preStartCmd && typeof raw.preStartCmd === 'string') {
    hooks.push({
      id: uuidv4(),
      enabled: false,
      phase: 'pre',
      event: 'lifecycle.start',
      kind: 'command',
      timeoutMs: DEFAULT_HOOK_TIMEOUT_MS,
      continueOnError: false,
      command: { exe: raw.preStartCmd, args: [] },
    });
  }
  if (raw.postStopCmd && typeof raw.postStopCmd === 'string') {
    hooks.push({
      id: uuidv4(),
      enabled: false,
      phase: 'post',
      event: 'lifecycle.stop',
      kind: 'command',
      timeoutMs: DEFAULT_HOOK_TIMEOUT_MS,
      continueOnError: false,
      command: { exe: raw.postStopCmd, args: [] },
    });
  }
  return hooks;
}

function collectExtraFields(raw: LegacyServerRaw): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  let found = false;
  for (const key of Object.keys(raw)) {
    if (!KNOWN_V0_KEYS.has(key)) {
      extra[key] = raw[key];
      found = true;
    }
  }
  return found ? extra : undefined;
}

function migrateOneServer(raw: LegacyServerRaw, workspaceFolder: string): ServerConfig & { 'x-extra'?: Record<string, unknown> } {
  const id = raw.id ?? uuidv4();
  const homePath = raw.serverHome ?? raw.homePath ?? '';
  const vmArgsRaw = raw.vmArgs;
  const vmArgs = Array.isArray(vmArgsRaw) ? vmArgsRaw : typeof vmArgsRaw === 'string' ? shellSplit(vmArgsRaw) : [];
  const instancePath = raw.instancePath ?? `${workspaceFolder}/.jsm/tomcat-bases/${id}/`;

  const pluginConfig: PluginConfig = {
    type: 'tomcat',
    shutdownPort: 8005,
    disableAjp: true,
  };

  const autosyncEnabled = raw.autoSync !== false;
  const hooks = migrateHooksFromLegacy(raw);
  const extra = collectExtraFields(raw);

  const config: ServerConfig & { 'x-extra'?: Record<string, unknown> } = {
    id,
    name: raw.name ?? 'Unnamed Server',
    type: (raw.type as ServerConfig['type']) ?? 'tomcat',
    runtime: {
      id: uuidv4(),
      homePath,
    },
    instancePath,
    javaHome: raw.javaHome ?? '',
    host: raw.host ?? '127.0.0.1',
    ports: {
      http: typeof raw.port === 'number' ? raw.port : 8080,
      debug: 5005,
    },
    run: { env: {}, vmArgs },
    debug: { enabled: true, bind: '127.0.0.1', attachDelayMs: 1000 },
    deployments: [] as DeploymentConfig[],
    autosync: {
      enabled: autosyncEnabled,
      debounceMs: 400,
      maxBatchFiles: 200,
      maxBatchBytes: 20_000_000,
      stormBackoffMs: 2000,
      ignoreGlobs: [...DEFAULT_AUTOSYNC_IGNORE_GLOBS],
    },
    hooks,
    pluginConfig,
  };

  if (extra) config['x-extra'] = extra;
  return config;
}

/**
 * Migrate a v0 config file (legacy format) to v1 WorkspaceConfig.
 * Pure function — no FS access.
 */
export function migrateV0toV1(legacyData: unknown, workspaceFolder: string): Result<WorkspaceConfig, JsmError> {
  try {
    if (!legacyData || typeof legacyData !== 'object') {
      return err(new JsmError({
        code: ErrorCode.MigrationFailed,
        message: 'Config data is not an object',
      }));
    }

    const raw = legacyData as Record<string, unknown>;
    let servers: LegacyServerRaw[];

    if (Array.isArray(raw['servers'])) {
      servers = raw['servers'] as LegacyServerRaw[];
    } else if (Array.isArray(legacyData)) {
      servers = legacyData as LegacyServerRaw[];
    } else {
      // Single server object
      servers = [raw as LegacyServerRaw];
    }

    const migrated = servers.map(s => migrateOneServer(s, workspaceFolder));

    return ok({
      schemaVersion: SCHEMA_VERSION,
      servers: migrated,
    });
  } catch (cause) {
    return err(new JsmError({
      code: ErrorCode.MigrationFailed,
      message: 'Migration failed unexpectedly',
      cause,
    }));
  }
}

import type {
  PluginConfig,
  ServerConfig,
  ServerTemplate,
  ServerType,
} from '@core/types';
import { normalizeHookList, validateHookList } from './hooks';
import type {
  AuthoringFieldError,
  CreateServerRequest,
  ServerAuthoringDraft,
  ServerCreationDefaults,
  ServerDraftDefaults,
  TemplateAuthoringDraft,
} from './types';

const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_DEBUG_PORT = 5005;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_DEBUG_BIND = '127.0.0.1';
export const REDACTED_SECRET_PLACEHOLDER = '[redacted]';

function hasValue(data: Record<string, unknown>, key: string): boolean {
  const value = data[key];
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  if (!hasValue(data, key)) return undefined;
  return String(data[key]).trim();
}

function optionalNumber(data: Record<string, unknown>, key: string): number | undefined {
  if (!hasValue(data, key)) return undefined;
  const parsed = Number(data[key]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function secretString(data: Record<string, unknown>, key: string, existing?: string): string {
  const value = String(data[key] ?? '');
  if (value === REDACTED_SECRET_PLACEHOLDER && existing !== undefined) {
    return existing;
  }
  return value;
}

function optionalSecretString(data: Record<string, unknown>, key: string, existing?: string): string | undefined {
  if (!hasValue(data, key)) return undefined;
  const value = String(data[key]).trim();
  if (value === REDACTED_SECRET_PLACEHOLDER) {
    return existing;
  }
  return value;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function normalizeServerType(value: unknown, fallback: ServerType = 'tomcat'): ServerType {
  return value === 'tomcat' ? value : fallback;
}

function cloneValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function buildTomcatPluginConfigFromRecord(
  data: Record<string, unknown>,
  existingPluginConfig?: PluginConfig,
): PluginConfig | undefined {
  const existing = existingPluginConfig?.type === 'tomcat'
    ? existingPluginConfig
    : undefined;

  if (data['pluginConfig.ssl.enabled'] !== true) {
    if (!existing) {
      return undefined;
    }

    const { ssl: _ssl, ...withoutSsl } = existing;
    return withoutSsl;
  }

  const clientAuth = data['pluginConfig.ssl.clientAuth'] === true;
  const existingSsl = existing?.ssl;

  return {
    type: 'tomcat',
    shutdownPort: existing?.shutdownPort ?? 8005,
    disableAjp: existing?.disableAjp ?? true,
    ssl: {
      enabled: true,
      port: optionalNumber(data, 'pluginConfig.ssl.port') ?? 8443,
      keystorePath: optionalString(data, 'pluginConfig.ssl.keystorePath') ?? '',
      keystorePassword: secretString(data, 'pluginConfig.ssl.keystorePassword', existingSsl?.keystorePassword),
      keystoreType: optionalString(data, 'pluginConfig.ssl.keystoreType') === 'JKS' ? 'JKS' : 'PKCS12',
      keyAlias: optionalString(data, 'pluginConfig.ssl.keyAlias'),
      clientAuth,
      truststorePath: clientAuth ? optionalString(data, 'pluginConfig.ssl.truststorePath') : undefined,
      truststorePassword: clientAuth
        ? optionalSecretString(data, 'pluginConfig.ssl.truststorePassword', existingSsl?.truststorePassword)
        : undefined,
      truststoreType: clientAuth
        ? (optionalString(data, 'pluginConfig.ssl.truststoreType') === 'JKS' ? 'JKS' : 'PKCS12')
        : undefined,
    },
  };
}

function pluginConfigToRecord(pluginConfig: PluginConfig | undefined): Record<string, unknown> {
  if (!pluginConfig || pluginConfig.type !== 'tomcat' || !pluginConfig.ssl) {
    return {};
  }

  return {
    'pluginConfig.ssl.enabled': pluginConfig.ssl.enabled,
    'pluginConfig.ssl.port': pluginConfig.ssl.port,
    'pluginConfig.ssl.keystorePath': pluginConfig.ssl.keystorePath,
    'pluginConfig.ssl.keystorePassword': pluginConfig.ssl.keystorePassword,
    'pluginConfig.ssl.keystoreType': pluginConfig.ssl.keystoreType,
    'pluginConfig.ssl.keyAlias': pluginConfig.ssl.keyAlias,
    'pluginConfig.ssl.clientAuth': pluginConfig.ssl.clientAuth,
    'pluginConfig.ssl.truststorePath': pluginConfig.ssl.truststorePath,
    'pluginConfig.ssl.truststorePassword': pluginConfig.ssl.truststorePassword,
    'pluginConfig.ssl.truststoreType': pluginConfig.ssl.truststoreType,
  };
}

function draftToPluginConfigRecord(draft: Partial<ServerAuthoringDraft>): Record<string, unknown> {
  return pluginConfigToRecord(draft.pluginConfig);
}

function mergeServerDraft(
  base: ServerAuthoringDraft,
  overrides?: Partial<ServerAuthoringDraft>,
): ServerAuthoringDraft {
  if (!overrides) {
    return {
      ...base,
      vmArgs: [...base.vmArgs],
      hooks: normalizeHookList(base.hooks),
      pluginConfig: cloneValue(base.pluginConfig),
    };
  }

  return {
    name: overrides.name ?? base.name,
    type: normalizeServerType(overrides.type, base.type),
    runtimeHomePath: overrides.runtimeHomePath ?? base.runtimeHomePath,
    javaHome: overrides.javaHome ?? base.javaHome,
    host: overrides.host ?? base.host,
    httpPort: overrides.httpPort ?? base.httpPort,
    debugPort: overrides.debugPort ?? base.debugPort,
    debugBind: overrides.debugBind ?? base.debugBind,
    vmArgs: overrides.vmArgs !== undefined ? [...overrides.vmArgs] : [...base.vmArgs],
    hooks: overrides.hooks !== undefined ? normalizeHookList(overrides.hooks) : normalizeHookList(base.hooks),
    pluginConfig: overrides.pluginConfig !== undefined
      ? cloneValue(overrides.pluginConfig)
      : cloneValue(base.pluginConfig),
  };
}

export function createServerDraft(options?: {
  defaults?: Partial<ServerCreationDefaults>;
  fallbackType?: ServerType;
  overrides?: Partial<ServerAuthoringDraft>;
}): ServerAuthoringDraft {
  const fallbackType = options?.fallbackType ?? 'tomcat';
  const defaults = options?.defaults;

  return mergeServerDraft({
    name: '',
    type: fallbackType,
    runtimeHomePath: '',
    javaHome: defaults?.defaultJavaHome ?? '',
    host: DEFAULT_HOST,
    httpPort: defaults?.defaultHttpPort ?? DEFAULT_HTTP_PORT,
    debugPort: defaults?.defaultDebugPort ?? DEFAULT_DEBUG_PORT,
    debugBind: DEFAULT_DEBUG_BIND,
    vmArgs: [],
    hooks: [],
    pluginConfig: undefined,
  }, options?.overrides);
}

export function serverConfigToDraft(config: ServerConfig): ServerAuthoringDraft {
  return {
    name: config.name,
    type: config.type,
    runtimeHomePath: config.runtime.homePath,
    javaHome: config.javaHome,
    host: config.host,
    httpPort: config.ports.http,
    debugPort: config.ports.debug,
    debugBind: config.debug.bind,
    vmArgs: [...config.run.vmArgs],
    hooks: normalizeHookList(config.hooks),
    pluginConfig: cloneValue(config.pluginConfig),
  };
}

export function serverDraftToFormData(draft: Partial<ServerAuthoringDraft>): Record<string, unknown> {
  return {
    ...(draft.name !== undefined ? { name: draft.name } : {}),
    ...(draft.type !== undefined ? { type: draft.type } : {}),
    ...(draft.runtimeHomePath !== undefined ? { 'runtime.homePath': draft.runtimeHomePath } : {}),
    ...(draft.javaHome !== undefined ? { javaHome: draft.javaHome } : {}),
    ...(draft.host !== undefined ? { host: draft.host } : {}),
    ...(draft.httpPort !== undefined ? { 'ports.http': draft.httpPort } : {}),
    ...(draft.debugPort !== undefined ? { 'ports.debug': draft.debugPort } : {}),
    ...(draft.debugBind !== undefined ? { 'debug.bind': draft.debugBind } : {}),
    ...(draft.vmArgs !== undefined ? { 'run.vmArgs': [...draft.vmArgs] } : {}),
    ...(draft.hooks !== undefined ? { hooks: normalizeHookList(draft.hooks) } : {}),
    ...draftToPluginConfigRecord(draft),
  };
}

export function serverConfigToFormData(config: ServerConfig): Record<string, unknown> {
  return {
    id: config.id,
    'runtime.version': config.runtime.version,
    ...serverDraftToFormData(serverConfigToDraft(config)),
  };
}

export function templateToServerDraftDefaults(template: ServerTemplate): ServerDraftDefaults {
  const defaults = template.serverDefaults;
  return {
    type: template.pluginType,
    runtimeHomePath: defaults.runtime?.homePath,
    javaHome: defaults.javaHome,
    host: defaults.host,
    httpPort: defaults.ports?.http,
    debugPort: defaults.ports?.debug,
    debugBind: defaults.debug?.bind,
    vmArgs: defaults.run?.vmArgs ? [...defaults.run.vmArgs] : undefined,
    hooks: defaults.hooks ? normalizeHookList(defaults.hooks) : undefined,
    pluginConfig: cloneValue(defaults.pluginConfig),
  };
}

export function applyTemplateToServerDraft(args: {
  template?: ServerTemplate;
  defaults?: Partial<ServerCreationDefaults>;
  fallbackType?: ServerType;
  overrides?: Partial<ServerAuthoringDraft>;
}): ServerAuthoringDraft {
  const base = createServerDraft({
    defaults: args.defaults,
    fallbackType: args.template?.pluginType ?? args.fallbackType ?? 'tomcat',
  });

  const withTemplate = args.template
    ? mergeServerDraft(base, templateToServerDraftDefaults(args.template))
    : base;

  return mergeServerDraft(withTemplate, args.overrides);
}

export function templateToServerFormData(template: ServerTemplate): Record<string, unknown> {
  const data = serverDraftToFormData(applyTemplateToServerDraft({ template }));
  if (data.name === '') {
    delete data.name;
  }
  if (Array.isArray(data.hooks) && data.hooks.length === 0) {
    delete data.hooks;
  }
  return data;
}

export function formDataToServerDraft(
  data: Record<string, unknown>,
  options?: {
    fallbackType?: ServerType;
    defaults?: Partial<ServerCreationDefaults>;
    existing?: ServerConfig;
  },
): ServerAuthoringDraft {
  const fallbackType = options?.fallbackType ?? options?.existing?.type ?? 'tomcat';
  const defaults = options?.defaults;

  return {
    name: String(data['name'] ?? options?.existing?.name ?? '').trim(),
    type: normalizeServerType(data['type'], fallbackType),
    runtimeHomePath: String(data['runtime.homePath'] ?? options?.existing?.runtime.homePath ?? '').trim(),
    javaHome: String(data['javaHome'] ?? defaults?.defaultJavaHome ?? options?.existing?.javaHome ?? '').trim(),
    host: String(data['host'] ?? options?.existing?.host ?? DEFAULT_HOST).trim(),
    httpPort: Number(data['ports.http'] ?? options?.existing?.ports.http ?? defaults?.defaultHttpPort ?? DEFAULT_HTTP_PORT),
    debugPort: optionalNumber(data, 'ports.debug'),
    debugBind: String(data['debug.bind'] ?? options?.existing?.debug.bind ?? DEFAULT_DEBUG_BIND).trim(),
    vmArgs: normalizeStringList(data['run.vmArgs'] ?? options?.existing?.run.vmArgs ?? []),
    hooks: normalizeHookList(data['hooks'] ?? options?.existing?.hooks ?? []),
    pluginConfig: buildTomcatPluginConfigFromRecord(
      data,
      options?.existing?.pluginConfig,
    ),
  };
}

export function applyServerDraftToConfig(
  draft: ServerAuthoringDraft,
  existing: ServerConfig,
): ServerConfig {
  return {
    ...existing,
    name: draft.name,
    type: draft.type,
    host: draft.host,
    javaHome: draft.javaHome,
    runtime: {
      ...existing.runtime,
      homePath: draft.runtimeHomePath,
    },
    ports: {
      http: draft.httpPort,
      debug: draft.debugPort ?? existing.ports.debug,
    },
    run: {
      ...existing.run,
      vmArgs: [...draft.vmArgs],
    },
    debug: {
      ...existing.debug,
      bind: draft.debugBind,
    },
    hooks: normalizeHookList(draft.hooks),
    pluginConfig: cloneValue(draft.pluginConfig),
  };
}

export function serverDraftToCreateServerRequest(draft: ServerAuthoringDraft): CreateServerRequest {
  return {
    name: draft.name,
    type: draft.type,
    runtimeHomePath: draft.runtimeHomePath,
    javaHome: draft.javaHome,
    host: draft.host,
    httpPort: draft.httpPort,
    debugPort: draft.debugPort ?? DEFAULT_DEBUG_PORT,
    debugBind: draft.debugBind,
    vmArgs: [...draft.vmArgs],
    hooks: normalizeHookList(draft.hooks),
    pluginConfig: cloneValue(draft.pluginConfig),
  };
}

export function formDataToServerConfig(
  data: Record<string, unknown>,
  existing: ServerConfig,
): ServerConfig {
  return applyServerDraftToConfig(
    formDataToServerDraft(data, { existing }),
    existing,
  );
}

export function formDataToCreateServerRequest(
  data: Record<string, unknown>,
  options?: {
    fallbackType?: ServerType;
    defaults?: Partial<ServerCreationDefaults>;
  },
): CreateServerRequest {
  return serverDraftToCreateServerRequest(
    formDataToServerDraft(data, {
      fallbackType: options?.fallbackType,
      defaults: options?.defaults,
    }),
  );
}

export function formDataToTemplateDraft(
  data: Record<string, unknown>,
  options?: {
    fallbackScope?: 'global' | 'workspace';
    fallbackPluginType?: ServerType;
  },
): TemplateAuthoringDraft {
  const pluginType = normalizeServerType(data['pluginType'], options?.fallbackPluginType ?? 'tomcat');

  return {
    name: String(data['name'] ?? '').trim(),
    description: optionalString(data, 'description'),
    scope: data['scope'] === 'global' ? 'global' : options?.fallbackScope ?? 'workspace',
    pluginType,
    serverDefaults: {
      type: pluginType,
      runtimeHomePath: optionalString(data, 'runtime.homePath'),
      javaHome: optionalString(data, 'javaHome'),
      host: optionalString(data, 'host'),
      httpPort: optionalNumber(data, 'ports.http'),
      debugPort: optionalNumber(data, 'ports.debug'),
      debugBind: optionalString(data, 'debug.bind'),
      vmArgs: normalizeStringList(data['run.vmArgs']),
      hooks: normalizeHookList(data['hooks']),
      pluginConfig: buildTomcatPluginConfigFromRecord(data),
    },
  };
}

export function templateDraftToTemplate(args: {
  id: string;
  draft: TemplateAuthoringDraft;
}): ServerTemplate {
  const { id, draft } = args;
  const defaults: ServerConfig['pluginConfig'] = draft.serverDefaults.pluginConfig;

  return {
    id,
    name: draft.name,
    description: draft.description,
    pluginType: draft.pluginType,
    serverDefaults: {
      runtime: draft.serverDefaults.runtimeHomePath
        ? { homePath: draft.serverDefaults.runtimeHomePath }
        : undefined,
      javaHome: draft.serverDefaults.javaHome,
      host: draft.serverDefaults.host,
      ports: {
        http: draft.serverDefaults.httpPort,
        debug: draft.serverDefaults.debugPort,
      },
      run: {
        vmArgs: draft.serverDefaults.vmArgs ? [...draft.serverDefaults.vmArgs] : [],
      },
      debug: {
        bind: draft.serverDefaults.debugBind,
      },
      hooks: draft.serverDefaults.hooks ? normalizeHookList(draft.serverDefaults.hooks) : [],
      pluginConfig: defaults,
    },
  };
}

export function validateServerForm(data: Record<string, unknown>): AuthoringFieldError[] {
  const errors: AuthoringFieldError[] = [];

  if (!data['name'] || String(data['name']).trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'Server name is required.',
      suggestedFix: 'Enter a display name for this server.',
    });
  }

  if (!data['runtime.homePath'] || String(data['runtime.homePath']).trim().length === 0) {
    errors.push({
      field: 'runtime.homePath',
      message: 'Server home path is required.',
      suggestedFix: 'Select the Tomcat installation directory.',
    });
  }

  if (!data['javaHome'] || String(data['javaHome']).trim().length === 0) {
    errors.push({
      field: 'javaHome',
      message: 'JAVA_HOME is required.',
      suggestedFix: 'Select the JDK installation directory.',
    });
  }

  const httpPort = Number(data['ports.http'] ?? DEFAULT_HTTP_PORT);
  if (!Number.isFinite(httpPort) || httpPort < 1 || httpPort > 65535) {
    errors.push({
      field: 'ports.http',
      message: 'HTTP port must be between 1 and 65535.',
      suggestedFix: `Use port ${DEFAULT_HTTP_PORT} (default) or another free port.`,
    });
  }

  const hasDebugPort = hasValue(data, 'ports.debug');
  const debugPort = hasDebugPort ? Number(data['ports.debug']) : undefined;
  if (hasDebugPort && (debugPort === undefined || debugPort < 1 || debugPort > 65535)) {
    errors.push({
      field: 'ports.debug',
      message: 'Debug port must be between 1 and 65535.',
      suggestedFix: `Use port ${DEFAULT_DEBUG_PORT} (default) or another free port.`,
    });
  }

  if (Number.isFinite(httpPort) && debugPort !== undefined && httpPort === debugPort) {
    errors.push({
      field: 'ports.debug',
      message: 'Debug port must differ from the HTTP port.',
      suggestedFix: `Choose a port other than ${httpPort}.`,
    });
  }

  const bind = String(data['debug.bind'] ?? DEFAULT_DEBUG_BIND);
  if (!['127.0.0.1', 'localhost', '::1'].includes(bind)) {
    errors.push({
      field: 'debug.bind',
      message: 'Debug bind address must be localhost-only.',
      suggestedFix: 'Use 127.0.0.1, localhost, or ::1.',
    });
  }

  if (data['pluginConfig.ssl.enabled'] === true) {
    if (!hasValue(data, 'pluginConfig.ssl.keystorePath')) {
      errors.push({
        field: 'pluginConfig.ssl.keystorePath',
        message: 'Keystore path is required when SSL is enabled.',
        suggestedFix: 'Choose the keystore file for HTTPS.',
      });
    }

    if (!hasValue(data, 'pluginConfig.ssl.keystorePassword')) {
      errors.push({
        field: 'pluginConfig.ssl.keystorePassword',
        message: 'Keystore password is required when SSL is enabled.',
        suggestedFix: 'Enter the keystore password.',
      });
    }
  }

  errors.push(...validateHookList(data['hooks'], 'hooks'));
  return errors;
}

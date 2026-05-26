import type {
  DeploymentBuildConfig,
  DeploymentConfig,
  DeploymentType,
  HookEvent,
  SyncMode,
} from '@core/types';
import { normalizeHookList, validateHookList } from './hooks';
import type {
  AuthoringFieldError,
  DeploymentAuthoringDraft,
} from './types';

const DEPLOY_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const DEPLOYMENT_HOOK_EVENTS: readonly HookEvent[] = [
  'deploy.full',
  'deploy.incremental',
  'deploy.undeploy',
] as const;
const DEFAULT_BUILD_TIMEOUT_MS = 60_000;

function normalizeDeploymentType(value: unknown): DeploymentType {
  return value === 'war' ? 'war' : 'exploded';
}

function normalizeSyncMode(value: unknown, _type: DeploymentType): SyncMode {
  return value === 'manual' ? 'manual' : 'auto';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeEnv(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const trimmedKey = key.trim();
    if (trimmedKey.length === 0 || typeof entry !== 'string') continue;
    env[trimmedKey] = entry;
  }
  return env;
}

function normalizeBuildTimeout(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1000
    ? value
    : DEFAULT_BUILD_TIMEOUT_MS;
}

function normalizeBuildConfig(value: unknown): DeploymentBuildConfig | undefined {
  if (!isRecord(value)) return undefined;

  const kind: DeploymentBuildConfig['kind'] = value['kind'] === 'vscodeTask' ? 'vscodeTask' : 'command';
  const trigger: DeploymentBuildConfig['trigger'] = value['trigger'] === 'manualAndAuto' ? 'manualAndAuto' : 'manual';
  const base = {
    enabled: value['enabled'] === true,
    kind,
    trigger,
    timeoutMs: normalizeBuildTimeout(value['timeoutMs']),
  };

  if (kind === 'vscodeTask') {
    const vscodeTask = isRecord(value['vscodeTask']) ? value['vscodeTask'] : {};
    return {
      ...base,
      kind,
      vscodeTask: {
        taskName: typeof vscodeTask['taskName'] === 'string' ? vscodeTask['taskName'] : '',
      },
    };
  }

  const command = isRecord(value['command']) ? value['command'] : {};
  const env = normalizeEnv(command['env']);
  const cwd = typeof command['cwd'] === 'string' && command['cwd'].trim().length > 0
    ? command['cwd'].trim()
    : undefined;

  return {
    ...base,
    kind,
    command: {
      mode: 'shell',
      line: typeof command['line'] === 'string' ? command['line'] : '',
      ...(cwd ? { cwd } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    },
  };
}

function cloneBuildConfig(build: DeploymentBuildConfig | undefined): DeploymentBuildConfig | undefined {
  return normalizeBuildConfig(build);
}

export function getDeploymentHookEvents(): readonly HookEvent[] {
  return DEPLOYMENT_HOOK_EVENTS;
}

export function deploymentConfigToDraft(config: DeploymentConfig): DeploymentAuthoringDraft {
  return {
    id: config.id,
    type: config.type,
    sourcePath: config.sourcePath,
    deployName: config.deployName,
    syncMode: config.syncMode,
    hotReload: config.hotReload,
    ignoreGlobs: [...config.ignoreGlobs],
    build: cloneBuildConfig(config.build),
    hooks: normalizeHookList(config.hooks, DEPLOYMENT_HOOK_EVENTS),
    healthCheckPath: config.healthCheckPath,
    healthCheckTimeoutMs: config.healthCheckTimeoutMs,
  };
}

export function deploymentDraftToFormData(draft: DeploymentAuthoringDraft): Record<string, unknown> {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    type: draft.type,
    sourcePath: draft.sourcePath,
    deployName: draft.deployName,
    syncMode: draft.syncMode,
    hotReload: draft.hotReload,
    ignoreGlobs: [...draft.ignoreGlobs],
    build: cloneBuildConfig(draft.build),
    hooks: normalizeHookList(draft.hooks, DEPLOYMENT_HOOK_EVENTS),
    healthCheckPath: draft.healthCheckPath,
    healthCheckTimeoutMs: draft.healthCheckTimeoutMs,
  };
}

export function formDataToDeploymentDraft(
  data: Record<string, unknown>,
  options?: { id?: string },
): DeploymentAuthoringDraft {
  const type = normalizeDeploymentType(data['type']);
  const rawTimeout = data['healthCheckTimeoutMs'];
  const parsedTimeout = rawTimeout === undefined || rawTimeout === null || String(rawTimeout).trim() === ''
    ? undefined
    : Number(rawTimeout);

  return {
    id: options?.id,
    type,
    sourcePath: String(data['sourcePath'] ?? '').trim(),
    deployName: String(data['deployName'] ?? '').trim(),
    syncMode: normalizeSyncMode(data['syncMode'], type),
    hotReload: type === 'exploded' && data['hotReload'] === true,
    ignoreGlobs: Array.isArray(data['ignoreGlobs'])
      ? (data['ignoreGlobs'] as string[]).filter(entry => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    build: normalizeBuildConfig(data['build']),
    hooks: normalizeHookList(data['hooks'], DEPLOYMENT_HOOK_EVENTS),
    healthCheckPath: typeof data['healthCheckPath'] === 'string' && data['healthCheckPath'].trim() !== ''
      ? data['healthCheckPath'].trim()
      : undefined,
    healthCheckTimeoutMs: typeof parsedTimeout === 'number' && parsedTimeout > 0
      ? parsedTimeout
      : undefined,
  };
}

export function deploymentDraftToConfig(
  draft: DeploymentAuthoringDraft,
  id: string,
): DeploymentConfig {
  return {
    id: draft.id ?? id,
    type: draft.type,
    sourcePath: draft.sourcePath,
    deployName: draft.deployName,
    syncMode: draft.syncMode,
    hotReload: draft.type === 'exploded' && draft.hotReload,
    ignoreGlobs: [...draft.ignoreGlobs],
    build: cloneBuildConfig(draft.build),
    hooks: normalizeHookList(draft.hooks, DEPLOYMENT_HOOK_EVENTS),
    healthCheckPath: draft.healthCheckPath,
    healthCheckTimeoutMs: draft.healthCheckTimeoutMs,
  };
}

export function formDataToDeploymentConfig(
  data: Record<string, unknown>,
  id: string,
): DeploymentConfig {
  return deploymentDraftToConfig(formDataToDeploymentDraft(data), id);
}

export function validateDeploymentForm(data: Record<string, unknown>): AuthoringFieldError[] {
  const errors: AuthoringFieldError[] = [];

  if (!data['sourcePath'] || String(data['sourcePath']).trim().length === 0) {
    errors.push({
      field: 'sourcePath',
      message: 'Source path is required.',
      suggestedFix: 'Select the WAR file or exploded directory.',
    });
  }

  const deployName = String(data['deployName'] ?? '');
  if (deployName.length === 0) {
    errors.push({
      field: 'deployName',
      message: 'Deploy name is required.',
      suggestedFix: 'Enter a context name (e.g. "myapp").',
    });
  } else if (!DEPLOY_NAME_PATTERN.test(deployName)) {
    errors.push({
      field: 'deployName',
      message: 'Invalid deploy name format.',
      suggestedFix: 'Must start with a letter/digit and contain only letters, digits, dots, dashes, underscores.',
    });
  }

  if (!['war', 'exploded'].includes(String(data['type'] ?? ''))) {
    errors.push({
      field: 'type',
      message: 'Deployment type is required.',
      suggestedFix: 'Select WAR or Exploded Directory.',
    });
  }

  const rawTimeout = data['healthCheckTimeoutMs'];
  if (rawTimeout !== undefined && rawTimeout !== null && String(rawTimeout).trim() !== '') {
    const timeout = Number(rawTimeout);
    if (!Number.isFinite(timeout) || timeout < 1) {
      errors.push({
        field: 'healthCheckTimeoutMs',
        message: 'Health check timeout must be a positive number.',
        suggestedFix: 'Use a timeout such as 5000 milliseconds, or leave the field empty.',
      });
    }
  }

  const rawBuild = data['build'];
  if (rawBuild !== undefined) {
    if (!isRecord(rawBuild)) {
      errors.push({
        field: 'build',
        message: 'Build configuration must be an object.',
        suggestedFix: 'Disable build or configure an explicit command/task.',
      });
    } else {
      const build = normalizeBuildConfig(rawBuild);
      if (build?.enabled) {
        if (!Number.isInteger(build.timeoutMs) || build.timeoutMs < 1000) {
          errors.push({
            field: 'build.timeoutMs',
            message: 'Build timeout must be an integer greater than or equal to 1000 ms.',
            suggestedFix: 'Use 60000 for the default timeout.',
          });
        }

        if (build.kind === 'command' && (!build.command || build.command.line.trim().length === 0)) {
          errors.push({
            field: 'build.command.line',
            message: 'Build command is required when Build before deploy is enabled.',
            suggestedFix: 'Enter the exact command to run, such as mvn package.',
          });
        }

        if (build.kind === 'vscodeTask' && (!build.vscodeTask || build.vscodeTask.taskName.trim().length === 0)) {
          errors.push({
            field: 'build.vscodeTask.taskName',
            message: 'Task name is required when Build before deploy is enabled.',
            suggestedFix: 'Choose the VS Code task to run.',
          });
        }
      }
    }
  }

  errors.push(...validateHookList(
    data['hooks'],
    'hooks',
    DEPLOYMENT_HOOK_EVENTS,
  ));

  return errors;
}

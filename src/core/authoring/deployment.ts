import type {
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

function normalizeDeploymentType(value: unknown): DeploymentType {
  return value === 'war' ? 'war' : 'exploded';
}

function normalizeSyncMode(value: unknown, type: DeploymentType): SyncMode {
  if (type === 'war') return 'manual';
  return value === 'manual' ? 'manual' : 'auto';
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
    syncMode: draft.type === 'war' ? 'manual' : draft.syncMode,
    hotReload: draft.type === 'exploded' && draft.hotReload,
    ignoreGlobs: [...draft.ignoreGlobs],
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

  errors.push(...validateHookList(
    data['hooks'],
    'hooks',
    DEPLOYMENT_HOOK_EVENTS,
  ));

  return errors;
}

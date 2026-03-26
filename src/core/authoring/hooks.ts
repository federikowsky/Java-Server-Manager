import type {
  HookCommandConfig,
  HookConfig,
  HookEvent,
  HookKind,
  HookPhase,
} from '@core/types';
import type { AuthoringFieldError } from './types';

const DEFAULT_HOOK_EVENTS: readonly HookEvent[] = [
  'lifecycle.start',
  'lifecycle.stop',
  'lifecycle.restart',
  'deploy.full',
  'deploy.incremental',
  'deploy.undeploy',
] as const;

const DEFAULT_TIMEOUT_MS = 60_000;

type HookInput = Partial<HookConfig> & {
  command?: {
    mode?: 'shell';
    line?: unknown;
    cwd?: unknown;
    env?: unknown;
  };
  vscodeTask?: Partial<NonNullable<HookConfig['vscodeTask']>>;
};

function createDefaultHookId(index: number): string {
  return `Hook-${index}`;
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

function normalizeTimeout(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1000
    ? value
    : DEFAULT_TIMEOUT_MS;
}

function normalizeKind(value: unknown): HookKind {
  return value === 'vscodeTask' ? 'vscodeTask' : 'command';
}

function normalizePhase(value: unknown): HookPhase {
  return value === 'post' || value === 'onError' ? value : 'pre';
}

function normalizeEvent(
  value: unknown,
  allowedEvents: readonly HookEvent[] = DEFAULT_HOOK_EVENTS,
): HookEvent {
  return allowedEvents.includes(value as HookEvent)
    ? (value as HookEvent)
    : allowedEvents[0] ?? 'lifecycle.start';
}

function normalizeCommand(command: HookInput['command']): HookCommandConfig {
  const env = normalizeEnv(command?.env);
  const cwd = typeof command?.cwd === 'string' && command.cwd.trim().length > 0
    ? command.cwd.trim()
    : undefined;
  const line = typeof command?.line === 'string' ? command.line : '';

  return {
    mode: 'shell',
    line,
    ...(cwd ? { cwd } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

function normalizeHook(
  input: unknown,
  index: number,
  allowedEvents: readonly HookEvent[],
): HookConfig {
  const raw = isRecord(input) ? (input as HookInput) : {};
  const kind = normalizeKind(raw.kind);
  const id = typeof raw.id === 'string' && raw.id.trim().length > 0
    ? raw.id.trim()
    : createDefaultHookId(index + 1);

  if (kind === 'vscodeTask') {
    return {
      id,
      enabled: raw.enabled !== false,
      phase: normalizePhase(raw.phase),
      event: normalizeEvent(raw.event, allowedEvents),
      kind,
      timeoutMs: normalizeTimeout(raw.timeoutMs),
      continueOnError: raw.continueOnError === true,
      vscodeTask: {
        taskName: typeof raw.vscodeTask?.taskName === 'string'
          ? raw.vscodeTask.taskName
          : '',
      },
    };
  }

  return {
    id,
    enabled: raw.enabled !== false,
    phase: normalizePhase(raw.phase),
    event: normalizeEvent(raw.event, allowedEvents),
    kind,
    timeoutMs: normalizeTimeout(raw.timeoutMs),
    continueOnError: raw.continueOnError === true,
    command: normalizeCommand(raw.command),
  };
}

export function getDefaultHookEvents(): readonly HookEvent[] {
  return DEFAULT_HOOK_EVENTS;
}

export function getHookCommandLine(command: HookConfig['command']): string {
  if (!command) return '';
  return command.line;
}

export function toShellCommand(
  line: string,
  current?: HookConfig['command'],
): HookCommandConfig {
  const env = normalizeEnv(current?.env);
  const cwd = typeof current?.cwd === 'string' && current.cwd.trim().length > 0
    ? current.cwd.trim()
    : undefined;

  return {
    mode: 'shell',
    line,
    ...(cwd ? { cwd } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

export function createDefaultHook(index: number, defaults?: { event?: HookEvent }): HookConfig {
  return {
    id: createDefaultHookId(index),
    enabled: true,
    phase: 'pre',
    event: defaults?.event ?? 'lifecycle.start',
    kind: 'command',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    continueOnError: false,
    command: {
      mode: 'shell',
      line: '',
    },
  };
}

export function normalizeHookList(
  value: unknown,
  allowedEvents: readonly HookEvent[] = DEFAULT_HOOK_EVENTS,
): HookConfig[] {
  if (!Array.isArray(value)) return [];
  return value.map((hook, index) => normalizeHook(hook, index, allowedEvents));
}

export function validateHookList(
  value: unknown,
  fieldPrefix = 'hooks',
  allowedEvents: readonly HookEvent[] = DEFAULT_HOOK_EVENTS,
): AuthoringFieldError[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [{
      field: fieldPrefix,
      message: 'Hooks must be a list.',
      suggestedFix: 'Remove invalid values and add hooks through the editor.',
    }];
  }

  const errors: AuthoringFieldError[] = [];
  const hooks = normalizeHookList(value, allowedEvents);

  hooks.forEach((hook, index) => {
    const base = `${fieldPrefix}[${index}]`;

    if (!allowedEvents.includes(hook.event)) {
      errors.push({
        field: `${base}.event`,
        message: 'This event is not allowed in this hook context.',
        suggestedFix: `Choose one of: ${allowedEvents.join(', ')}.`,
      });
    }

    if (hook.id.trim().length === 0) {
      errors.push({
        field: `${base}.id`,
        message: 'Hook ID is required.',
        suggestedFix: 'Use the default Hook-N identifier or replace it with a stable technical identifier.',
      });
    }

    if (!Number.isInteger(hook.timeoutMs) || hook.timeoutMs < 1000) {
      errors.push({
        field: `${base}.timeoutMs`,
        message: 'Timeout must be an integer greater than or equal to 1000 ms.',
        suggestedFix: 'Use 60000 for the default timeout.',
      });
    }

    if (hook.kind === 'command') {
      if (!hook.command) {
        errors.push({
          field: `${base}.command.line`,
          message: 'Hook command is required.',
          suggestedFix: 'Enter a terminal command to run.',
        });
      } else if (hook.command.line.trim().length === 0) {
        errors.push({
          field: `${base}.command.line`,
          message: 'Command line is required for terminal hooks.',
          suggestedFix: 'Enter a command such as npm run build && npm test.',
        });
      }
    }

    if (hook.kind === 'vscodeTask' && (!hook.vscodeTask || hook.vscodeTask.taskName.trim().length === 0)) {
      errors.push({
        field: `${base}.vscodeTask.taskName`,
        message: 'Task name is required for VS Code task hooks.',
        suggestedFix: 'Choose the VS Code task to execute.',
      });
    }
  });

  return errors;
}

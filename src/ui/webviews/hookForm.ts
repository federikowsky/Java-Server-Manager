import {
  createDefaultHook,
  getDefaultHookEvents,
  getHookCommandLine,
  normalizeHookList,
  toShellCommand,
  validateHookList,
} from '@core/authoring';
import type { HookEvent, HookKind, HookPhase } from '@core/types';

export const HOOK_PHASE_OPTIONS: { value: HookPhase; label: string }[] = [
  { value: 'pre', label: 'Pre' },
  { value: 'post', label: 'Post' },
  { value: 'onError', label: 'On Error' },
];

export const HOOK_EVENT_OPTIONS: { value: HookEvent; label: string }[] = getDefaultHookEvents().map(value => ({
  value,
  label: value
    .split('.')
    .map(part => part === 'onError' ? 'On Error' : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' '),
}));

export const HOOK_KIND_OPTIONS: { value: HookKind; label: string }[] = [
  { value: 'command', label: 'Command' },
  { value: 'vscodeTask', label: 'VS Code Task' },
];

export {
  createDefaultHook,
  getHookCommandLine,
  normalizeHookList,
  toShellCommand,
  validateHookList,
};

import { REDACTED_SECRET_PLACEHOLDER } from '@core/authoring';

const SECRET_KEY_PATTERN = /(password|passwd|secret|token|credential|api[_-]?key|(^|[_\-.])pass($|[_\-.]))/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value);
}

function shouldRedactKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function redactDashboardSecrets<T>(value: T, key = ''): T {
  if (typeof value === 'string' && shouldRedactKey(key)) {
    return REDACTED_SECRET_PLACEHOLDER as T;
  }

  if (Array.isArray(value)) {
    return value.map(item => redactDashboardSecrets(item)) as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactDashboardSecrets(entryValue, entryKey),
    ]),
  ) as T;
}

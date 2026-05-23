import type {
  ServerConfig,
  ServerId,
} from '@core/types';
import type { ServerRuntimeState } from '@core/types/runtime';

// ── Log Redaction (§12.6) ──────────────────────────────────────────────────

const REDACTED_VALUE = '***REDACTED***';

/**
 * Key names whose values must never leave the diagnostics boundary.
 * Keep this narrower than "contains key" so non-secret paths such as
 * keystorePath remain useful in support bundles.
 */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|pwd|secret|token|api[_-]?key|apikey|credential|authorization|private[_-]?key|access[_-]?key|(^|[_-])auth($|[_-])/i;

const SENSITIVE_ASSIGNMENT_PATTERN =
  /([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|credential|authorization|private[_-]?key|access[_-]?key|auth)[A-Za-z0-9_.-]*)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi;

const BEARER_TOKEN_PATTERN = /\bBearer\s+(["']?)[^"',\s]+(["']?)/gi;

// ── Diagnostics Bundle (§11.3) ─────────────────────────────────────────────

export interface DiagnosticsBundle {
  timestamp: string;
  extensionVersion: string;
  servers: Array<{
    config: Omit<ServerConfig, 'run'> & { run: { env: Record<string, string>; vmArgs: string[] } };
    runtimeState: ServerRuntimeState | undefined;
  }>;
  logs: string;
}

/**
 * Diagnostics service (§11.3-§11.4, §12.6).
 * Generates debug bundles with sensitive data redaction.
 */
export class DiagnosticsService {
  private readonly extensionVersion: string;
  private readonly getConfigs: () => ServerConfig[];
  private readonly getRuntimeState: (serverId: ServerId) => ServerRuntimeState | undefined;
  private readonly getLogBuffer: () => string;

  constructor(deps: {
    extensionVersion: string;
    getConfigs: () => ServerConfig[];
    getRuntimeState: (serverId: ServerId) => ServerRuntimeState | undefined;
    getLogBuffer: () => string;
  }) {
    this.extensionVersion = deps.extensionVersion;
    this.getConfigs = deps.getConfigs;
    this.getRuntimeState = deps.getRuntimeState;
    this.getLogBuffer = deps.getLogBuffer;
  }

  /**
   * Generate a full diagnostics bundle with redacted sensitive data.
   */
  generateBundle(): DiagnosticsBundle {
    const configs = this.getConfigs();

    const servers = configs.map(config => ({
      config: this.redactConfig(config),
      runtimeState: this.getRuntimeState(config.id),
    }));

    const logs = this.redactString(this.getLogBuffer());

    return {
      timestamp: new Date().toISOString(),
      extensionVersion: this.extensionVersion,
      servers,
      logs,
    };
  }

  /**
   * Generate bundle as formatted JSON string, ready for clipboard.
   */
  generateBundleText(): string {
    const bundle = this.generateBundle();
    return JSON.stringify(bundle, null, 2);
  }

  // ── Redaction ─────────────────────────────────────────────────────

  /** Redact a config object without mutating the source configuration. */
  private redactConfig(
    config: ServerConfig,
  ): DiagnosticsBundle['servers'][number]['config'] {
    return this.redactValue(config) as DiagnosticsBundle['servers'][number]['config'];
  }

  private redactValue(value: unknown, key = ''): unknown {
    if (this.isSensitiveKey(key)) {
      return REDACTED_VALUE;
    }

    if (typeof value === 'string') {
      return this.redactString(value);
    }

    if (Array.isArray(value)) {
      return value.map(item => this.redactValue(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
          entryKey,
          this.redactValue(entryValue, entryKey),
        ]),
      );
    }

    return value;
  }

  private isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEY_PATTERN.test(key);
  }

  /** Redact sensitive patterns in arbitrary text (logs). */
  private redactString(text: string): string {
    return text
      .replace(BEARER_TOKEN_PATTERN, (_match, openQuote: string, closeQuote: string) => (
        `Bearer ${openQuote}${REDACTED_VALUE}${closeQuote}`
      ))
      .replace(SENSITIVE_ASSIGNMENT_PATTERN, `$1$2${REDACTED_VALUE}`);
  }
}

import type {
  ServerConfig,
  ServerId,
} from '@core/types';
import type { ServerRuntimeState } from '@core/types/runtime';

// ── Log Redaction (§12.6) ──────────────────────────────────────────────────

/**
 * Word-boundary regex for sensitive values.
 * Matches password, secret, token, api_key, api-key, apikey, auth, credential.
 */
const REDACT_PATTERN =
  /\b(password|secret|token|api[_-]?key|auth|credential)\b\s*[:=]\s*\S+/gi;

const REDACTED_REPLACEMENT = '$1=***REDACTED***';

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

  /** Redact a config object — removes env values that look sensitive. */
  private redactConfig(
    config: ServerConfig,
  ): DiagnosticsBundle['servers'][number]['config'] {
    const redactedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.run.env)) {
      redactedEnv[key] = this.isEnvKeySensitive(key) ? '***REDACTED***' : value;
    }

    return {
      ...config,
      run: {
        env: redactedEnv,
        vmArgs: config.run.vmArgs,
      },
    };
  }

  /** Check if an env key looks sensitive. */
  private isEnvKeySensitive(key: string): boolean {
    return REDACT_PATTERN.test(key) || (REDACT_PATTERN.lastIndex = 0, false) ||
      /password|secret|token|key|auth|credential/i.test(key);
  }

  /** Redact sensitive patterns in arbitrary text (logs). */
  private redactString(text: string): string {
    return text.replace(REDACT_PATTERN, REDACTED_REPLACEMENT);
  }
}

import type { ServerConfig } from '../types';
import type { Result } from '../result';
import { ok, err } from '../result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';
import { BLOCKED_ENV_KEYS, BLOCKED_VMARGS_PREFIXES } from '../../constants';

/**
 * Validate server config against security blocklists (§12.9).
 * Rejects configs containing dangerous env keys or vmArg prefixes.
 */
export function validateSecurityPolicy(config: ServerConfig): Result<void, JsmError> {
  // Check blocked environment variables
  for (const key of Object.keys(config.run.env)) {
    if (BLOCKED_ENV_KEYS.has(key)) {
      return err(new JsmError({
        code: ErrorCode.SecurityPolicyViolation,
        message: `Environment variable '${key}' is blocked by security policy`,
      }));
    }
  }

  // Check blocked vmArgs prefixes
  for (const arg of config.run.vmArgs) {
    const lower = arg.toLowerCase();
    for (const prefix of BLOCKED_VMARGS_PREFIXES) {
      if (lower.startsWith(prefix.toLowerCase())) {
        return err(new JsmError({
          code: ErrorCode.SecurityPolicyViolation,
          message: `VM argument '${arg}' is blocked by security policy (prefix: ${prefix})`,
        }));
      }
    }
  }

  return ok(undefined);
}

import type { TrustGate } from '../types';
import type { Result } from '../result';
import { ok, err } from '../result';
import { JsmError } from '../errors/JsmError';
import { ErrorCode } from '../errors/codes';

export function requireWorkspaceTrust(
  trustGate: TrustGate | undefined,
  action: string,
): Result<void, JsmError> {
  if (trustGate && !trustGate.isTrusted()) {
    return err(new JsmError({
      code: ErrorCode.WorkspaceUntrusted,
      message: `Grant workspace trust to ${action}.`,
    }));
  }

  return ok(undefined);
}

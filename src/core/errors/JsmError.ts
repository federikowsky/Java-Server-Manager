import { ErrorCode, type ErrorSeverity, defaultSeverity } from './codes';

export interface JsmErrorInit {
  code: ErrorCode;
  message: string;
  severity?: ErrorSeverity;
  details?: string;
  suggestedFix?: string[];
  cause?: unknown;
}

export class JsmError {
  readonly code: ErrorCode;
  readonly severity: ErrorSeverity;
  readonly message: string;
  readonly details?: string;
  readonly suggestedFix?: string[];
  readonly cause?: unknown;

  constructor(init: JsmErrorInit) {
    this.code = init.code;
    this.severity = init.severity ?? defaultSeverity(init.code);
    this.message = init.message;
    this.details = init.details;
    this.suggestedFix = init.suggestedFix;
    this.cause = init.cause;
  }

  /** Convenience factory for wrapping an unknown thrown value. */
  static fromUnknown(err: unknown, code = ErrorCode.Unknown): JsmError {
    const message = err instanceof Error ? err.message : String(err);
    return new JsmError({ code, message, cause: err });
  }
}

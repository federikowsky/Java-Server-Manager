/*
* src/core/errors/JsmError.ts
* Single error class with code enumeration for the entire extension.
*/

import type { ErrorCode } from './codes';

export class JsmError<D = unknown> extends Error {
  readonly code: ErrorCode;
  readonly details?: D;

  constructor(code: ErrorCode, message: string, details?: D) {
    super(message);
    this.name = 'JsmError';
    this.code = code;
    this.details = details;
  }
}

export const isJsmError = (e: unknown): e is JsmError<unknown> => e instanceof JsmError;
export const hasCode = (e: unknown, code: ErrorCode): boolean => isJsmError(e) && e.code === code;

/**
 * Extended coverage: JsmError factory and severity defaults (Negative / Observability).
 * Maps to feature F-ERRORS.
 */
import { describe, it, expect } from 'vitest';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode, defaultSeverity } from '@core/errors/codes';

describe('JsmError (extended)', () => {
  it('EXT-ERR-001: fromUnknown wraps Error instance', () => {
    const e = JsmError.fromUnknown(new Error('boom'));
    expect(e.message).toBe('boom');
    expect(e.code).toBe(ErrorCode.Unknown);
    expect(e.cause).toBeInstanceOf(Error);
  });

  it('EXT-ERR-002: fromUnknown stringifies non-Error values', () => {
    const e = JsmError.fromUnknown(42);
    expect(e.message).toBe('42');
  });

  it('EXT-ERR-003: fromUnknown accepts custom code', () => {
    const e = JsmError.fromUnknown('x', ErrorCode.InvalidConfig);
    expect(e.code).toBe(ErrorCode.InvalidConfig);
  });

  it('EXT-ERR-004: explicit severity overrides default', () => {
    const base = defaultSeverity(ErrorCode.Cancelled);
    const e = new JsmError({
      code: ErrorCode.Cancelled,
      message: 'm',
      severity: 'error',
    });
    expect(e.severity).toBe('error');
    expect(e.severity).not.toBe(base);
  });

  it('EXT-ERR-005: optional details and suggestedFix preserved', () => {
    const e = new JsmError({
      code: ErrorCode.ConfigReadFailed,
      message: 'read failed',
      details: 'line 1',
      suggestedFix: ['fix a', 'fix b'],
    });
    expect(e.details).toBe('line 1');
    expect(e.suggestedFix).toEqual(['fix a', 'fix b']);
  });
});

/**
 * Extended coverage: Result helpers map/andThen/unwrap (Happy / Negative / Corner).
 * Maps to feature F-RESULT.
 */
import { describe, it, expect } from 'vitest';
import { ok, err, map, andThen, unwrap } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

describe('Result combinators (extended)', () => {
  it('EXT-RES-001: map transforms ok value', () => {
    const r = map(ok(2), n => n * 3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(6);
  });

  it('EXT-RES-002: map preserves error', () => {
    const e = new JsmError({ code: ErrorCode.Unknown, message: 'x' });
    const r = map(err(e), () => 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(e);
  });

  it('EXT-RES-003: andThen short-circuits on error', () => {
    const e = new JsmError({ code: ErrorCode.Unknown, message: 'e' });
    const r = andThen(err(e), () => ok(1));
    expect(r.ok).toBe(false);
  });

  it('EXT-RES-004: andThen chains successes', () => {
    const r = andThen(ok(2), n => ok(String(n)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('2');
  });

  it('EXT-RES-005: unwrap returns value on ok', () => {
    expect(unwrap(ok('v'))).toBe('v');
  });

  it('EXT-RES-006: unwrap throws the carried error value', () => {
    const e = new JsmError({ code: ErrorCode.Unknown, message: 'bad' });
    expect(() => unwrap(err(e))).toThrow();
    try {
      unwrap(err(e));
    } catch (thrown) {
      expect(thrown).toBe(e);
    }
  });
});

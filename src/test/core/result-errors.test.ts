import { describe, it, expect } from 'vitest';
import { ok, err, unwrap, map, andThen, type Result } from '@core/result';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

describe('Result', () => {
  it('ok() creates success result', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBe(42);
  });

  it('err() creates failure result', () => {
    const r = err('boom');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('boom');
  });

  it('unwrap() returns value on success', () => {
    expect(unwrap(ok('hello'))).toBe('hello');
  });

  it('unwrap() throws on failure', () => {
    expect(() => unwrap(err('fail'))).toThrow();
  });

  it('map() transforms success value', () => {
    const r = map(ok(3), v => v * 2);
    expect(r.ok && r.value).toBe(6);
  });

  it('map() passes through error', () => {
    const r = map(err('e') as Result<number, string>, v => v * 2);
    expect(!r.ok && r.error).toBe('e');
  });

  it('andThen() chains on success', () => {
    const r = andThen(ok(10), v => v > 5 ? ok('big') : err('small'));
    expect(r.ok && r.value).toBe('big');
  });

  it('andThen() short-circuits on error', () => {
    const r = andThen(err('e') as Result<number, string>, () => ok('x'));
    expect(!r.ok && r.error).toBe('e');
  });
});

describe('JsmError', () => {
  it('uses default severity from error code', () => {
    const e = new JsmError({ code: ErrorCode.PortInUse, message: 'port busy' });
    expect(e.severity).toBe('error');
    expect(e.code).toBe(ErrorCode.PortInUse);
  });

  it('allows severity override', () => {
    const e = new JsmError({ code: ErrorCode.Timeout, message: 'slow', severity: 'error' });
    expect(e.severity).toBe('error'); // default for Timeout is 'warning'
  });

  it('fromUnknown wraps Error instances', () => {
    const e = JsmError.fromUnknown(new Error('oops'));
    expect(e.code).toBe(ErrorCode.Unknown);
    expect(e.message).toBe('oops');
    expect(e.cause).toBeInstanceOf(Error);
  });

  it('fromUnknown wraps non-Error values', () => {
    const e = JsmError.fromUnknown('string error');
    expect(e.message).toBe('string error');
  });
});

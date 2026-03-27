/**
 * Extended coverage: cancellation token semantics (Stateful / Concurrency / Recovery).
 * Maps to feature F-CANCELLATION.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createCancellationTokenSource,
  cancellationError,
  throwIfCancelled,
  cancellationPromise,
} from '@core/ops/OperationCancellation';

describe('Operation cancellation (extended)', () => {
  it('EXT-CAN-001: cancel is idempotent', () => {
    const src = createCancellationTokenSource();
    src.cancel();
    src.cancel();
    expect(src.token.isCancelled).toBe(true);
  });

  it('EXT-CAN-002: onCancelled fires immediately if already cancelled', () => {
    const src = createCancellationTokenSource();
    src.cancel();
    const cb = vi.fn();
    src.token.onCancelled(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('EXT-CAN-003: listener errors during cancel do not prevent cancellation', () => {
    const src = createCancellationTokenSource();
    src.token.onCancelled(() => {
      throw new Error('listener boom');
    });
    expect(() => src.cancel()).not.toThrow();
    expect(src.token.isCancelled).toBe(true);
  });

  it('EXT-CAN-004: dispose removes listener before cancel', () => {
    const src = createCancellationTokenSource();
    const cb = vi.fn();
    const d = src.token.onCancelled(cb);
    d.dispose();
    src.cancel();
    expect(cb).not.toHaveBeenCalled();
  });

  it('EXT-CAN-005: throwIfCancelled throws JsmError with Cancelled code', () => {
    const src = createCancellationTokenSource();
    src.cancel();
    expect(() => throwIfCancelled(src.token, 'stop')).toThrow();
    try {
      throwIfCancelled(src.token, 'stop');
    } catch (e) {
      expect(e).toMatchObject({ code: 'Cancelled', message: 'stop' });
    }
  });

  it('EXT-CAN-006: cancellationPromise rejects when already cancelled', async () => {
    const src = createCancellationTokenSource();
    src.cancel();
    await expect(cancellationPromise(src.token, 'x')).rejects.toMatchObject({
      code: 'Cancelled',
    });
  });

  it('EXT-CAN-007: cancellationPromise rejects after async cancel', async () => {
    const src = createCancellationTokenSource();
    const p = cancellationPromise(src.token, 'later');
    src.cancel();
    await expect(p).rejects.toMatchObject({ code: 'Cancelled' });
  });

  it('EXT-CAN-008: cancellationError builds consistent shape', () => {
    const e = cancellationError('aborted');
    expect(e.code).toBe('Cancelled');
    expect(e.message).toBe('aborted');
  });
});

/*
 * src/core/utils/result.ts
 * Foundation utility: functional-style Result wrapper.
 */

export type Ok<T>  = { ok: true;  value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/**
 * Convert a promise that may reject into a `Result`.
 */
export async function fromPromise<T, E = unknown>(
  promise: Promise<T>,
  mapError: (e: unknown) => E
): Promise<Result<T, E>> {
  try {
    const value = await promise;
    return ok(value);
  } catch (e) {
    return err(mapError(e));
  }
}

/**
 * Transform the value side.
 */
export const map = <T, U, E>(
  r: Result<T, E>,
  fn: (v: T) => U
): Result<U, E> => (r.ok ? ok(fn(r.value)) : r as Err<E>);

/**
 * Transform the error side.
 */
export const mapErr = <T, E, F>(
  r: Result<T, E>,
  fn: (e: E) => F
): Result<T, F> => (r.ok ? r as Ok<T> : err(fn((r as Err<E>).error)));

/**
 * Chain computations that themselves return a `Result`.
 */
export const andThen = <T, U, E, F>(
  r: Result<T, E>,
  fn: (v: T) => Result<U, F>
): Result<U, E | F> => (r.ok ? fn(r.value) : r as Err<E>);

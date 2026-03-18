/**
 * Discriminated union result type.
 * `ok: true` carries a value; `ok: false` carries an error.
 */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Create a success result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Create a failure result. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Unwrap a result, throwing if it's an error. Useful in tests. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

/** Map the success value. */
export function map<T, U, E>(result: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  if (result.ok) return ok(fn(result.value));
  return result;
}

/** Chain results (flatMap / andThen). */
export function andThen<T, U, E>(result: Result<T, E>, fn: (v: T) => Result<U, E>): Result<U, E> {
  if (result.ok) return fn(result.value);
  return result;
}

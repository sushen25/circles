/**
 * A success or an expected failure, as a value.
 *
 * Domain functions return `Result` rather than throwing, because "you cannot
 * confirm yet" and "not enough people were free" are ordinary outcomes the UI
 * has to render, not exceptions. Throwing is reserved for programmer error —
 * a malformed instant, a weight with no font file.
 */
/**
 * Note for callers: if you assign `err(...)` to a variable annotated
 * `Result<E, T>`, TypeScript narrows it to `Err<E>`, and `map` then has no `Ok`
 * branch to infer `T` from. Pass the result of a function that returns
 * `Result<E, T>`, which is how real code reads anyway.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<E, T> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<E, T>(result: Result<E, T>): result is Ok<T> {
  return result.ok;
}

export function isErr<E, T>(result: Result<E, T>): result is Err<E> {
  return !result.ok;
}

/** Transform the value, leaving a failure untouched. */
export function map<E, T, U>(result: Result<E, T>, f: (value: T) => U): Result<E, U> {
  return result.ok ? ok(f(result.value)) : result;
}

/** Transform the error, leaving a success untouched. */
export function mapErr<E, F, T>(result: Result<E, T>, f: (error: E) => F): Result<F, T> {
  return result.ok ? result : err(f(result.error));
}

/** Chain another fallible step. The first failure short-circuits. */
export function andThen<E, T, U>(
  result: Result<E, T>,
  f: (value: T) => Result<E, U>,
): Result<E, U> {
  return result.ok ? f(result.value) : result;
}

/** The value, or a fallback. */
export function unwrapOr<E, T>(result: Result<E, T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Collect a list of results into a result of a list. The first failure wins —
 * callers that want every error should collect them explicitly.
 */
export function all<E, T>(results: readonly Result<E, T>[]): Result<E, T[]> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

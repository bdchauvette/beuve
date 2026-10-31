import type { Result } from './result.ts';

/** Chains a step that can itself fail; the first failure short-circuits. */
export function andThen<T, U, E, F>(
  result: Result<T, E>,
  next: (value: T) => Result<U, F>,
): Result<U, E | F> {
  if (result.ok) {
    return next(result.value);
  }
  return result;
}

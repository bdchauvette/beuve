import type { Ok, Result } from './result.ts';

/** Narrows a result to its success branch. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

import type { Err, Result } from './result.ts';

/** Narrows a result to its failure branch. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

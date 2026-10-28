import { ok } from './ok.ts';
import type { Result } from './result.ts';

/** Transforms the success value, passing failures through unchanged. */
export function mapResult<T, U, E>(result: Result<T, E>, transform: (value: T) => U): Result<U, E> {
  return result.ok ? ok(transform(result.value)) : result;
}

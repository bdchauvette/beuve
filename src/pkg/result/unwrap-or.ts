import type { Result } from './result.ts';

/** Returns the success value, or `fallback` on failure. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

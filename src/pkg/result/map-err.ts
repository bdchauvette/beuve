import { err } from './err.ts';
import type { Result } from './result.ts';

/** Transforms the failure, passing successes through unchanged. */
export function mapErr<T, E, F>(result: Result<T, E>, transform: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(transform(result.error));
}

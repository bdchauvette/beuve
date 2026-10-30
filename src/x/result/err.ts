import type { Err } from './result.ts';

/** Wraps an expected failure. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

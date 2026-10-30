import type { Ok } from './result.ts';

/** Wraps a success value. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

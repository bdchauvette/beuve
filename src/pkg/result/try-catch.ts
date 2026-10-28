import { err } from './err.ts';
import { ok } from './ok.ts';
import type { Result } from './result.ts';

/** Runs `run`, capturing a thrown exception as an `Err` via `toError`. */
export function tryCatch<T, E>(run: () => T, toError: (cause: unknown) => E): Result<T, E> {
  try {
    return ok(run());
  } catch (error: unknown) {
    return err(toError(error));
  }
}

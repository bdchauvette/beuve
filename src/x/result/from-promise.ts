import { err } from './err.ts';
import { ok } from './ok.ts';
import type { Result } from './result.ts';

/** Settles `promise` into a `Result`, mapping a rejection through `toError`. */
export async function fromPromise<T, E>(
  promise: PromiseLike<T>,
  toError: (cause: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await promise);
  } catch (error: unknown) {
    return err(toError(error));
  }
}

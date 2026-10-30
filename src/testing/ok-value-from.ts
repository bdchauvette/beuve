import type { Result } from '#x/result/result.ts';

/**
 * The value of an `ok` result; throws with the error otherwise. For test setup that needs a value
 * to go on, so tests narrow results without `if` (ADR 0058). Assert the result itself instead when
 * it is what the test checks.
 */
export function okValueFrom<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected an ok result, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

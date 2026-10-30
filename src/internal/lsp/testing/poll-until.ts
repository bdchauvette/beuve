import { Stopwatch } from '#x/time/stopwatch.ts';

/**
 * Calls `poll` every 20 ms until it returns something other than `undefined`, and returns that.
 * Throws after `timeout` (10 s by default) so a missing condition fails the test instead of hanging.
 */
export async function pollUntil<T>(
  description: string,
  poll: () => T | undefined | Promise<T | undefined>,
  timeout: Temporal.Duration = Temporal.Duration.from({ seconds: 10 }),
): Promise<T> {
  const waited = new Stopwatch();
  for (;;) {
    const value = await poll();
    if (value !== undefined) {
      return value;
    }
    if (Temporal.Duration.compare(waited.elapsed(), timeout) > 0) {
      throw new Error(`${description} did not happen in time`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

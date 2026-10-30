import { Stopwatch } from '#x/time/stopwatch.ts';

/** Polls `isDone` every `interval` until it holds; rejects naming `what` after `timeout`. */
export async function waitUntil(
  isDone: () => boolean,
  what: string,
  timeout = Temporal.Duration.from({ seconds: 15 }),
  interval = Temporal.Duration.from({ milliseconds: 20 }),
): Promise<void> {
  const stopwatch = new Stopwatch();
  while (!isDone()) {
    if (Temporal.Duration.compare(stopwatch.elapsed(), timeout) > 0) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, interval.total('milliseconds'));
    });
  }
}

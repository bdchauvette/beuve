import { Stopwatch } from '#x/time/stopwatch.ts';

/** How long to wait in all (15 seconds by default), and between polls (20 milliseconds). */
export interface WaitOptions {
  readonly timeout?: Temporal.Duration;
  readonly interval?: Temporal.Duration;
}

/** Polls `isDone` every `interval` until it holds; rejects naming `what` after `timeout`. */
export async function waitUntil(
  isDone: () => boolean,
  what: string,
  {
    timeout = Temporal.Duration.from({ seconds: 15 }),
    interval = Temporal.Duration.from({ milliseconds: 20 }),
  }: WaitOptions = {},
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

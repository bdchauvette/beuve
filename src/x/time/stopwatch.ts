/* eslint-disable local/no-time-number-arithmetic -- monotonic clock source for Stopwatch (ADR 0059) */
/** Options for {@link Stopwatch}. */
export interface StopwatchOptions {
  /** Monotonic nanoseconds. Defaults to `process.hrtime.bigint`, else `performance.now()`. */
  readonly now?: () => bigint;
}

/**
 * Measures time elapsed since it was constructed, on a monotonic clock, so a wall-clock step
 * (NTP, sleep) cannot stretch or shrink a measurement the way `Temporal.Now.instant()` differences
 * can. Tests that need to control elapsed time pass a fake `now`. This file is the only place
 * `performance.now()` or `process.hrtime` may be read (ADR 0059).
 */
export class Stopwatch {
  readonly #now: () => bigint;
  readonly #startedAt: bigint;

  constructor(options: StopwatchOptions = {}) {
    this.#now = options.now ?? defaultNow();
    this.#startedAt = this.#now();
  }

  /** Time since construction, balanced into seconds, milliseconds, microseconds and nanoseconds. */
  elapsed(): Temporal.Duration {
    return Temporal.Duration.from({ nanoseconds: Number(this.#now() - this.#startedAt) }).round({
      largestUnit: 'second',
    });
  }
}

/** `process.hrtime.bigint` where a Node `process` exists (main, workers, tests); else the renderer's clock. */
function defaultNow(): () => bigint {
  const host: { readonly process?: { readonly hrtime?: { readonly bigint?: () => bigint } } } =
    globalThis;
  const hrtime = host.process?.hrtime?.bigint;
  return hrtime ?? ((): bigint => BigInt(Math.round(performance.now() * 1_000_000)));
}

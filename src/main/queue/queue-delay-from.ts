/** What decides when the review queue refreshes next. */
export interface QueueDelayInput {
  /** The pace without failures. */
  readonly interval: Temporal.Duration;
  /** Refreshes in a row that got nothing from GitHub. */
  readonly failures: number;
  /** When a rate limit the last refresh met resets. */
  readonly rateLimitedUntil: string | undefined;
}

const shortest = Temporal.Duration.from({ minutes: 1 });
const longest = Temporal.Duration.from({ minutes: 30 });

/**
 * The delay before the next refresh (ADR 0113): until a rate limit resets (at least a minute, at
 * most 30), else the interval doubled for each failed refresh in a row, at most 30 minutes.
 */
export function queueDelayFrom({
  interval,
  failures,
  rateLimitedUntil,
}: QueueDelayInput): Temporal.Duration {
  if (rateLimitedUntil !== undefined) {
    const untilReset = Temporal.Now.instant()
      .until(Temporal.Instant.from(rateLimitedUntil))
      .add({ seconds: 1 });
    return clamp(untilReset);
  }
  let delay = interval;
  for (let doubled = 0; doubled < failures; doubled += 1) {
    if (Temporal.Duration.compare(delay, longest) >= 0) {
      return longest;
    }
    delay = delay.add(delay);
  }
  if (Temporal.Duration.compare(delay, longest) > 0) {
    return longest;
  }
  return delay;
}

function clamp(delay: Temporal.Duration): Temporal.Duration {
  if (Temporal.Duration.compare(delay, shortest) < 0) {
    return shortest;
  }
  if (Temporal.Duration.compare(delay, longest) > 0) {
    return longest;
  }
  return delay;
}

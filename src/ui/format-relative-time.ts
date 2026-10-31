/** “just now”, “5 min ago”, “3 h ago”, “yesterday”, “4 days ago”, then a date. Pure. */
export function formatRelativeTime(iso: string, now: Temporal.Instant): string {
  let then: Temporal.Instant;
  try {
    then = Temporal.Instant.from(iso);
  } catch {
    return '';
  }
  const elapsed = elapsedBetween(then, now);
  const whole = elapsed.round({
    largestUnit: 'day',
    smallestUnit: 'minute',
    roundingMode: 'trunc',
  });
  const isUnder = (limit: Temporal.DurationLike): boolean => {
    return Temporal.Duration.compare(elapsed, limit) < 0;
  };
  if (isUnder({ minutes: 1 })) {
    return 'just now';
  }
  if (isUnder({ hours: 1 })) {
    return `${String(whole.minutes)} min ago`;
  }
  if (isUnder({ days: 1 })) {
    return `${String(whole.hours)} h ago`;
  }
  if (isUnder({ days: 2 })) {
    return 'yesterday';
  }
  if (isUnder({ days: 7 })) {
    return `${String(whole.days)} days ago`;
  }
  return then.toLocaleString(undefined, { month: 'short', day: 'numeric' });
}

/** Zero when `start` is after `end`, so clock skew never reads as negative time. */
function elapsedBetween(start: Temporal.Instant, end: Temporal.Instant): Temporal.Duration {
  if (Temporal.Instant.compare(start, end) > 0) {
    return new Temporal.Duration();
  }
  return start.until(end);
}

/**
 * `0.7 s` style: milliseconds under a second, one decimal above; empty when unknown. Takes the
 * ISO-8601 duration string the contract carries (`PT0.712S`).
 */
export function formatDuration(isoDuration: string | undefined): string {
  if (isoDuration === undefined) {
    return '';
  }
  const duration = Temporal.Duration.from(isoDuration);
  if (Temporal.Duration.compare(duration, { seconds: 1 }) < 0) {
    const rounded = duration.round({
      largestUnit: 'millisecond',
      smallestUnit: 'millisecond',
      roundingMode: 'halfExpand',
    });
    return `${String(rounded.milliseconds)} ms`;
  }
  return `${duration.total('seconds').toFixed(1)} s`;
}

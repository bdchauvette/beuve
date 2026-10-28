/** `0.7 s` style: milliseconds under a second, one decimal above; empty when unknown. */
export function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return '';
  }
  return durationMs < 1000
    ? `${String(Math.round(durationMs))} ms`
    : `${(durationMs / 1000).toFixed(1)} s`;
}

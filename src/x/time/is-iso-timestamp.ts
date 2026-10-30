const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/**
 * True for a real UTC instant in the stored form `Temporal.Instant#toString({
 * fractionalSecondDigits: 3 })` produces (the same as `Date#toISOString()`), e.g.
 * `2026-10-28T12:00:00.000Z`.
 */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !isoUtc.test(value)) {
    return false;
  }
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}

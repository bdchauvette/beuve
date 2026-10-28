const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** True for a UTC timestamp in the exact form `Date.prototype.toISOString()` produces. */
export function isIsoTimestamp(value: string): boolean {
  return isoUtc.test(value) && !Number.isNaN(Date.parse(value));
}

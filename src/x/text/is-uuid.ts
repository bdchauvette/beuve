const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;

/** True for a lowercase, hyphenated UUID as `crypto.randomUUID()` produces. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

const calverTag = /^v(\d{4})\.([1-9]|1[0-2])\.([1-9]\d*)$/;

/**
 * True for a release tag `v<year>.<month>.<n>` (ADR 0049): a four-digit year, a month 1-12 and a
 * positive release number, all without leading zeros. `release.yml` enforces the same pattern.
 */
export function isCalverTag(tag: string): boolean {
  return calverTag.test(tag);
}

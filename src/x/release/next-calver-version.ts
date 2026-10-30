import { isCalverTag } from './is-calver-tag.ts';

/**
 * The next release version `<year>.<month>.<n>` for `date`, read in UTC (ADR 0049). `n` is one
 * more than the highest `v<year>.<month>.<n>` among `tags`, or 1 for the first release of the
 * month. Tags that aren't calver tags, and calver tags from other months, are ignored.
 */
export function nextCalverVersion(tags: readonly string[], date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1);
  const prefix = `v${year}.${month}.`;
  const numbers = tags
    .filter((tag) => isCalverTag(tag) && tag.startsWith(prefix))
    .map((tag) => Number(tag.slice(prefix.length)));
  const highest = Math.max(0, ...numbers);
  return `${year}.${month}.${String(highest + 1)}`;
}

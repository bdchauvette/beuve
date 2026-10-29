const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** “just now”, “5 min ago”, “3 h ago”, “yesterday”, “4 days ago”, then a date. Pure. */
export function formatRelativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  const elapsed = Math.max(0, now - then);
  if (elapsed < minute) {
    return 'just now';
  }
  if (elapsed < hour) {
    return `${String(Math.floor(elapsed / minute))} min ago`;
  }
  if (elapsed < day) {
    return `${String(Math.floor(elapsed / hour))} h ago`;
  }
  if (elapsed < 2 * day) {
    return 'yesterday';
  }
  if (elapsed < 7 * day) {
    return `${String(Math.floor(elapsed / day))} days ago`;
  }
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

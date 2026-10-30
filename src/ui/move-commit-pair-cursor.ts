/**
 * The row a key moves the commit-pair list's cursor to: `j`/`ArrowDown` and `k`/`ArrowUp` step
 * (clamped), `Home`/`End` jump. `undefined` for any other key, so the caller leaves it alone.
 */
export function moveCommitPairCursor(
  cursor: number,
  count: number,
  key: string,
): number | undefined {
  if (count === 0) {
    return undefined;
  }
  const last = count - 1;
  const current = Math.min(Math.max(cursor, 0), last);
  switch (key) {
    case 'j':
    case 'ArrowDown': {
      return Math.min(current + 1, last);
    }
    case 'k':
    case 'ArrowUp': {
      return Math.max(current - 1, 0);
    }
    case 'Home': {
      return 0;
    }
    case 'End': {
      return last;
    }
    default: {
      return undefined;
    }
  }
}

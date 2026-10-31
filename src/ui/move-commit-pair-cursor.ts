/** The list's cursor row and how many rows it has. */
export interface ListCursor {
  readonly cursor: number;
  readonly count: number;
}

/**
 * The row a key moves the commit-pair list's cursor to: `ArrowDown` and `ArrowUp` step
 * (clamped), `Home`/`End` jump. `undefined` for any other key, so the caller leaves it alone.
 */
export function moveCommitPairCursor(
  key: string,
  { cursor, count }: ListCursor,
): number | undefined {
  if (count === 0) {
    return undefined;
  }
  const last = count - 1;
  const current = Math.min(Math.max(cursor, 0), last);
  switch (key) {
    case 'ArrowDown': {
      return Math.min(current + 1, last);
    }
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

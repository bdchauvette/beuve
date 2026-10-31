/** What a sheet shows: a file at a commit, from a line or whole. */
export interface SheetTitleParts {
  readonly path: string;
  readonly sha: string;
  readonly line: number | undefined;
}

/**
 * A sheet's window title and heading (ADR 0067): `path:line · abc1234`, the line left out for
 * the whole file, so a stack of sheets reads as which file, where, and at which commit. Pure.
 */
export function sheetTitleFrom({ path, sha, line }: SheetTitleParts): string {
  const commit = sha.slice(0, 7);
  if (line === undefined) {
    return `${path} · ${commit}`;
  }
  return `${path}:${String(line)} · ${commit}`;
}

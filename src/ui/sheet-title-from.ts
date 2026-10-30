/**
 * A sheet's window title and heading (ADR 0067): `path:line · abc1234`, the line left out for
 * the whole file, so a stack of sheets reads as which file, where, and at which commit. Pure.
 */
export function sheetTitleFrom(path: string, sha: string, line: number | undefined): string {
  return `${path}${line === undefined ? '' : `:${String(line)}`} · ${sha.slice(0, 7)}`;
}

/** How much work review edits hold: changed files, and commits beyond the reviewed head. */
export interface EditCounts {
  readonly files: number;
  readonly commits: number;
}

/** "2 files changed, 1 commit": how much work review edits hold (ADR 0088). Pure. */
export function describeEditCounts({ files, commits }: EditCounts): string {
  const parts = [`${plural(files, 'file')} changed`];
  if (commits > 0) {
    parts.push(plural(commits, 'commit'));
  }
  return parts.join(', ');
}

function plural(value: number, noun: string): string {
  if (value === 1) {
    return `1 ${noun}`;
  }
  return `${String(value)} ${noun}s`;
}

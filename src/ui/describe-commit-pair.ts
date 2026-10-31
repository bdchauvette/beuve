import type { CommitPairView } from '#contract/ipc-contract.ts';

import { countNoun } from './count-noun.ts';

/** What one row of the commit-pair list shows. */
export interface CommitPairRow {
  readonly id: string;
  readonly kind: CommitPairView['kind'];
  /** `a1b2c3d → e4f5a6b`, with `·` for a missing side. */
  readonly commits: string;
  readonly chip: string;
  readonly subject: string;
  /** `+3 −1` for the new commit (the previous one when dropped), or `''` when empty. */
  readonly stats: string;
  /** Hover text: the full shas, the previous subject when it changed, the pair's interdiff. */
  readonly title: string;
  /** Whether filtering the diff stream to this pair can show anything. */
  readonly isFilterable: boolean;
}

const chips: Readonly<Record<CommitPairView['kind'], string>> = {
  unchanged: 'same',
  modified: 'changed',
  added: 'new',
  dropped: 'dropped',
};

/** Describes a commit pair for the compact pair list (ADR 0054). */
export function describeCommitPair(pair: CommitPairView): CommitPairRow {
  const shown = pair.next ?? pair.previous;
  const additions = shown?.additions ?? 0;
  const deletions = shown?.deletions ?? 0;
  let stats = '';
  if (additions + deletions > 0) {
    stats = `+${String(additions)} −${String(deletions)}`;
  }
  return {
    id: pair.id,
    kind: pair.kind,
    commits: `${short(pair.previous?.sha)} → ${short(pair.next?.sha)}`,
    chip: chips[pair.kind],
    subject: pair.subject,
    stats,
    title: describeTitle(pair),
    isFilterable: pair.kind !== 'dropped',
  };
}

function short(sha: string | undefined): string {
  if (sha === undefined) {
    return '·';
  }
  return sha.slice(0, 7);
}

function describeTitle(pair: CommitPairView): string {
  const { previous, next } = pair;
  const lines: string[] = [];
  if (previous !== undefined) {
    lines.push(`was ${previous.sha}`);
  }
  if (next !== undefined) {
    lines.push(`now ${next.sha}`);
  }
  if (previous !== undefined && next !== undefined && previous.subject !== next.subject) {
    lines.push(`previously “${previous.subject}”`);
  }
  if (pair.similarity !== undefined) {
    lines.push(`${String(Math.round(pair.similarity * 100))}% of changed lines in common`);
  }
  const interdiff = describeInterdiff(pair);
  if (interdiff !== undefined) {
    lines.push(interdiff);
  }
  return lines.join('\n');
}

function describeInterdiff(pair: CommitPairView): string | undefined {
  const { interdiff } = pair;
  if (interdiff === undefined) {
    if (pair.kind === 'dropped') {
      return 'no longer in this pull request';
    }
    return undefined;
  }
  switch (interdiff.kind) {
    case 'clean': {
      const count = interdiff.files.length;
      return `changed since review in ${countNoun(count, 'file')}`;
    }
    case 'conflicts': {
      return `rebased with conflicts in ${interdiff.paths.join(', ')}`;
    }
    case 'unavailable': {
      if (interdiff.reason === 'git-too-old') {
        return 'no per-commit interdiff: git is too old';
      }
      return 'no per-commit interdiff: too many changed commits';
    }
  }
}

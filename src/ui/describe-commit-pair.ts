import type { CommitPairView } from '#contract/ipc-contract.ts';

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
  const stats = additions + deletions === 0 ? '' : `+${String(additions)} −${String(deletions)}`;
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
  return sha === undefined ? '·' : sha.slice(0, 7);
}

function describeTitle(pair: CommitPairView): string {
  const lines = [
    pair.previous === undefined ? undefined : `was ${pair.previous.sha}`,
    pair.next === undefined ? undefined : `now ${pair.next.sha}`,
    pair.previous === undefined ||
    pair.next === undefined ||
    pair.previous.subject === pair.next.subject
      ? undefined
      : `previously “${pair.previous.subject}”`,
    pair.similarity === undefined
      ? undefined
      : `${String(Math.round(pair.similarity * 100))}% of changed lines in common`,
    describeInterdiff(pair),
  ];
  return lines.filter((line) => line !== undefined).join('\n');
}

function describeInterdiff(pair: CommitPairView): string | undefined {
  const { interdiff } = pair;
  if (interdiff === undefined) {
    return pair.kind === 'dropped' ? 'no longer in this pull request' : undefined;
  }
  switch (interdiff.kind) {
    case 'clean': {
      const count = interdiff.files.length;
      return `changed since review in ${String(count)} ${count === 1 ? 'file' : 'files'}`;
    }
    case 'conflicts': {
      return `rebased with conflicts in ${interdiff.paths.join(', ')}`;
    }
    case 'unavailable': {
      return interdiff.reason === 'git-too-old'
        ? 'no per-commit interdiff: git is too old'
        : 'no per-commit interdiff: too many changed commits';
    }
  }
}

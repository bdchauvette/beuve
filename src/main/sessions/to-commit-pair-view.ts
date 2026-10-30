import type { CommitPairView, CommitSideView } from '#contract/ipc-contract.ts';
import type { CommitPair } from '#internal/git/compute-commit-pairs.ts';
import type { RangeCommit } from '#internal/git/list-range-commits.ts';

import { toDiffFileView } from './to-diff-file-view.ts';

/** Maps a git-domain commit pair to the contract's view, keyed by its new (else previous) sha. */
export function toCommitPairView(pair: CommitPair): CommitPairView {
  const previous = 'previous' in pair ? toSide(pair.previous) : undefined;
  const next = 'next' in pair ? toSide(pair.next) : undefined;
  const common = {
    id: next?.sha ?? previous?.sha ?? '',
    kind: pair.kind,
    subject: next?.subject ?? previous?.subject ?? '',
    ...(previous !== undefined && { previous }),
    ...(next !== undefined && { next }),
  };
  if (pair.kind !== 'modified') {
    return common;
  }
  const { interdiff } = pair;
  return {
    ...common,
    similarity: Math.round(pair.similarity * 100) / 100,
    interdiff:
      interdiff.kind === 'clean'
        ? { kind: 'clean', files: interdiff.files.map((file) => toDiffFileView(file)) }
        : interdiff.kind === 'conflicts'
          ? { kind: 'conflicts', paths: [...interdiff.paths] }
          : {
              kind: 'unavailable',
              reason: interdiff.kind === 'skipped' ? interdiff.reason : 'git-too-old',
            },
  };
}

function toSide(commit: RangeCommit): CommitSideView {
  let additions = 0;
  let deletions = 0;
  for (const file of commit.files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'added') {
          additions += 1;
        } else if (line.kind === 'removed') {
          deletions += 1;
        }
      }
    }
  }
  return { sha: commit.sha, subject: commit.subject, additions, deletions };
}

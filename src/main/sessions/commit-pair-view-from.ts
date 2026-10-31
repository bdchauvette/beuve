import type {
  CommitInterdiffView,
  CommitPairView,
  CommitSideView,
} from '#contract/ipc-contract.ts';
import type { CommitPair } from '#internal/git/compute-commit-pairs.ts';
import type { RangeCommit } from '#internal/git/list-range-commits.ts';

import { diffFileViewFrom } from './diff-file-view-from.ts';

/** Maps a git-domain commit pair to the contract's view, keyed by its new (else previous) sha. */
export function commitPairViewFrom(pair: CommitPair): CommitPairView {
  let previous: CommitSideView | undefined;
  if ('previous' in pair) {
    previous = sideFrom(pair.previous);
  }
  let next: CommitSideView | undefined;
  if ('next' in pair) {
    next = sideFrom(pair.next);
  }
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
    interdiff: interdiffViewFrom(interdiff),
  };
}

function interdiffViewFrom(
  interdiff: Extract<CommitPair, { kind: 'modified' }>['interdiff'],
): CommitInterdiffView {
  switch (interdiff.kind) {
    case 'clean': {
      return { kind: 'clean', files: interdiff.files.map((file) => diffFileViewFrom(file)) };
    }
    case 'conflicts': {
      return { kind: 'conflicts', paths: [...interdiff.paths] };
    }
    case 'skipped': {
      return { kind: 'unavailable', reason: interdiff.reason };
    }
    default: {
      return { kind: 'unavailable', reason: 'git-too-old' };
    }
  }
}

function sideFrom(commit: RangeCommit): CommitSideView {
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

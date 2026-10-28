import type { DiffFileView } from '#contract/ipc-contract.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';

/** Maps a parsed git diff file to the contract's view: paths, counts, hunk positions, patch. */
export function toDiffFileView(file: DiffFile): DiffFileView {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'added') {
        additions += 1;
      } else if (line.kind === 'removed') {
        deletions += 1;
      }
    }
  }
  const common = {
    additions,
    deletions,
    binary: file.binary,
    hunks: file.hunks.map(({ oldStart, oldCount, newStart, newCount, header }) => ({
      oldStart,
      oldCount,
      newStart,
      newCount,
      header,
    })),
    patch: file.patch,
  };
  switch (file.status) {
    case 'added':
    case 'deleted':
    case 'modified': {
      return { status: file.status, path: file.path, ...common };
    }
    case 'renamed':
    case 'copied': {
      return { status: file.status, path: file.newPath, oldPath: file.oldPath, ...common };
    }
  }
}

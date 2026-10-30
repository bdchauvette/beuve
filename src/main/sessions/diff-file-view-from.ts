import type { DiffFileView } from '#contract/ipc-contract.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';

const zeroIdPattern = /^0+$/u;

/** Maps a parsed git diff file to the contract's view: paths, counts, hunk positions, patch, blobs. */
export function diffFileViewFrom(file: DiffFile): DiffFileView {
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
    ...blobSha('oldBlobSha', file.oldObject),
    ...blobSha('newBlobSha', file.newObject),
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

function blobSha<K extends 'oldBlobSha' | 'newBlobSha'>(
  key: K,
  objectId: string | undefined,
): Partial<Record<K, string>> {
  return objectId === undefined || zeroIdPattern.test(objectId)
    ? {}
    : ({ [key]: objectId } as Partial<Record<K, string>>);
}

import type { FileLineMapping, LineMappingHunk } from './line-mapping.ts';
import { changeRegionsFrom } from './change-regions-from.ts';
import type { UraAnchor } from './ura-item.ts';

/** An anchor moved to the later head, or the reason it can't be. */
export type ReanchoredAnchor =
  | { readonly kind: 'current'; readonly anchor: UraAnchor }
  | { readonly kind: 'outdated'; readonly reason: 'lines-changed' | 'file-deleted' };

/**
 * Maps an anchor written against an older head onto a later one, as GitHub does with review
 * comments: a line range follows its file through renames and shifts with edits above it, and is
 * outdated when any of its lines changed or lines were inserted inside it. Insertions directly
 * before or after the range only move it. A file anchor follows renames; a whole-change anchor
 * never moves. Both are outdated only when their file was deleted.
 */
export function reanchorUraAnchor(
  anchor: UraAnchor,
  files: readonly FileLineMapping[],
): ReanchoredAnchor {
  if (anchor.kind === 'change') {
    return { kind: 'current', anchor };
  }
  const file = files.find((candidate) => oldPath(candidate) === anchor.path);
  if (file === undefined) {
    return { kind: 'current', anchor };
  }
  if (file.kind === 'deleted') {
    return { kind: 'outdated', reason: 'file-deleted' };
  }
  const path = file.kind === 'renamed' ? file.newPath : file.path;
  if (anchor.kind === 'file') {
    return { kind: 'current', anchor: { kind: 'file', path } };
  }
  const shift = shiftRange(anchor.startLine, anchor.endLine, file.hunks);
  if (shift === undefined) {
    return { kind: 'outdated', reason: 'lines-changed' };
  }
  return {
    kind: 'current',
    anchor: {
      kind: 'lines',
      path,
      startLine: anchor.startLine + shift,
      endLine: anchor.endLine + shift,
    },
  };
}

function oldPath(file: FileLineMapping): string {
  if (file.kind === 'renamed') {
    return file.oldPath;
  }
  return file.path;
}

/** How far lines `start`–`end` moved, or `undefined` when the change touched them. */
function shiftRange(
  start: number,
  end: number,
  hunks: readonly LineMappingHunk[],
): number | undefined {
  let shift = 0;
  const regions = hunks.flatMap((hunk) => changeRegionsFrom(hunk));
  for (const region of regions) {
    if (region.removed === 0) {
      if (region.before < start) {
        shift += region.added;
        continue;
      }
      if (region.before >= end) {
        break;
      }
      return undefined;
    }
    if (region.before + region.removed < start) {
      shift += region.added - region.removed;
      continue;
    }
    if (region.before + 1 > end) {
      break;
    }
    return undefined;
  }
  return shift;
}

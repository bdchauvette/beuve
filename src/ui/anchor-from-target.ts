import type { UraAnchorView } from '#contract/ipc-contract.ts';

import type { ReviewTarget } from './target-from.ts';

/**
 * Where Add Note stages a note on `target` (ADR 0063). URA anchors are head-side only (ADR 0023), so
 * a base selection takes its mapped head lines and a pure deletion the head line before it; a
 * deleted file's lines anchor to the file. Pure.
 */
export function anchorFromTarget(target: ReviewTarget): UraAnchorView {
  if (target.kind === 'change') {
    return { kind: 'change' };
  }
  const { path } = target.file;
  const lines = (start: number, end: number): UraAnchorView => {
    return {
      kind: 'lines',
      path,
      startLine: start,
      endLine: end,
    };
  };
  switch (target.kind) {
    case 'selection': {
      if (target.head === undefined) {
        return { kind: 'file', path };
      }
      return lines(target.head.start, target.head.end);
    }
    case 'hunk': {
      if (target.file.status === 'deleted') {
        return { kind: 'file', path };
      }
      return lines(target.head?.start ?? target.line, target.head?.end ?? target.line);
    }
    case 'line': {
      return lines(target.line, target.line);
    }
    case 'file': {
      return { kind: 'file', path };
    }
  }
}

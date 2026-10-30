import type { UraAnchorView } from '#contract/ipc-contract.ts';

import type { ReviewTarget } from './target-from.ts';

/**
 * Where `m` stages a note on `target` (ADR 0063). URA anchors are head-side only (ADR 0023), so
 * a base selection takes its mapped head lines and a pure deletion the head line before it; a
 * deleted file's lines anchor to the file. Pure.
 */
export function anchorFromTarget(target: ReviewTarget): UraAnchorView {
  if (target.kind === 'change') {
    return { kind: 'change' };
  }
  const { path } = target.file;
  const lines = (start: number, end: number): UraAnchorView => ({
    kind: 'lines',
    path,
    startLine: start,
    endLine: end,
  });
  switch (target.kind) {
    case 'selection': {
      return target.head === undefined
        ? { kind: 'file', path }
        : lines(target.head.start, target.head.end);
    }
    case 'hunk': {
      return target.file.status === 'deleted'
        ? { kind: 'file', path }
        : lines(target.head?.start ?? target.line, target.head?.end ?? target.line);
    }
    case 'line': {
      return lines(target.line, target.line);
    }
    case 'file': {
      return { kind: 'file', path };
    }
  }
}

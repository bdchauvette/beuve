import type { ReviewTarget } from './target-from.ts';

/** What a permalink from the diff (ADR 0067) points at: a side's commit, a path, maybe lines. */
export interface PermalinkPlace {
  readonly side: 'head' | 'base';
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

/**
 * The place Copy GitHub Permalink and Open on GitHub link to, from the review target (ADR 0063): a selection's own
 * lines on its side, a hunk's head lines (its base lines for a pure deletion), a jump's line, and
 * the whole file for a file target; a deleted file links its base side. `undefined` for the
 * whole change. Pure.
 */
export function permalinkPlaceFrom(target: ReviewTarget): PermalinkPlace | undefined {
  if (target.kind === 'change') {
    return undefined;
  }
  const { file } = target;
  const basePath = file.oldPath ?? file.path;
  if (file.status === 'deleted') {
    if (target.kind === 'selection' && target.side === 'base') {
      return { side: 'base', path: basePath, startLine: target.start, endLine: target.end };
    }
    return { side: 'base', path: basePath };
  }
  switch (target.kind) {
    case 'selection': {
      if (target.side === 'base') {
        return { side: 'base', path: basePath, startLine: target.start, endLine: target.end };
      }
      return { side: 'head', path: file.path, startLine: target.start, endLine: target.end };
    }
    case 'hunk': {
      if (target.head !== undefined) {
        const { start, end } = target.head;
        return { side: 'head', path: file.path, startLine: start, endLine: end };
      }
      if (target.base !== undefined) {
        const { start, end } = target.base;
        return { side: 'base', path: basePath, startLine: start, endLine: end };
      }
      return { side: 'head', path: file.path };
    }
    case 'line': {
      return { side: 'head', path: file.path, startLine: target.line, endLine: target.line };
    }
    case 'file': {
      return { side: 'head', path: file.path };
    }
  }
}

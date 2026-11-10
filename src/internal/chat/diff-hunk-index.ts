import path from 'node:path';

import type { ChatQuestion } from './chat-question.ts';
import { parseHunkRanges } from './parse-hunk-ranges.ts';
import type { HeadRange } from './parse-hunk-ranges.ts';

/** Head-side lines a model pointed at, as it wrote them: the path not yet normalized. */
export interface ModelLines {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Where model lines land in the reviewed diff: on a head-side text file, narrowed to the hunks
 * they touch (`isClamped` when that cut them), with the file's place in diff order; or why not.
 */
export type HunkAnchor =
  | {
      readonly kind: 'in-diff';
      /** Repository-relative, `/`-separated. */
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
      readonly isClamped: boolean;
      /** The file's index in the diff. */
      readonly order: number;
    }
  /** Not a head-side text file of the diff. */
  | { readonly kind: 'unknown-file' }
  /** In a diff file but outside every hunk. */
  | { readonly kind: 'outside-diff' };

/**
 * The hunks of a reviewed diff's head-side text files, for checking that model output points at
 * lines a reviewer can act on (ADR 0055, 0132). Paths are normalized from `./x` or an absolute
 * worktree path; a range is narrowed to the hunks it touches. Pure.
 */
export class DiffHunkIndex {
  private readonly files = new Map<string, { order: number; ranges: HeadRange[] }>();
  private readonly worktreePath: string | undefined;

  constructor(input: Pick<ChatQuestion, 'files' | 'worktreePath'>) {
    this.worktreePath = input.worktreePath;
    for (const [order, file] of input.files.entries()) {
      if (file.status !== 'deleted' && !file.binary) {
        this.files.set(file.path, { order, ranges: parseHunkRanges(file.patch) });
      }
    }
  }

  /** Where `lines` land in the diff; see {@link HunkAnchor}. */
  anchor(lines: ModelLines): HunkAnchor {
    const filePath = normalizePath(lines.path, this.worktreePath);
    if (filePath === undefined) {
      return { kind: 'unknown-file' };
    }
    const file = this.files.get(filePath);
    if (file === undefined) {
      return { kind: 'unknown-file' };
    }
    const low = Math.min(lines.startLine, lines.endLine);
    const high = Math.max(lines.startLine, lines.endLine);
    const touched = file.ranges.filter((range) => range.start <= high && range.end >= low);
    const first = touched[0];
    const last = touched.at(-1);
    if (first === undefined || last === undefined) {
      return { kind: 'outside-diff' };
    }
    const startLine = Math.max(low, first.start);
    const endLine = Math.min(high, last.end);
    return {
      kind: 'in-diff',
      path: filePath,
      startLine,
      endLine,
      isClamped: startLine !== low || endLine !== high,
      order: file.order,
    };
  }
}

const leadingDotSlashes = /^(?:\.\/)+/u;

function normalizePath(raw: string, worktreePath: string | undefined): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (path.isAbsolute(trimmed)) {
    if (worktreePath === undefined) {
      return undefined;
    }
    const relative = path.relative(worktreePath, trimmed);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      return undefined;
    }
    return relative.split(path.sep).join('/');
  }
  return trimmed.replace(leadingDotSlashes, '');
}

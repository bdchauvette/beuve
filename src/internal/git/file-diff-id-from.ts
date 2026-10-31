import { createHash } from 'node:crypto';

import type { DiffFile, DiffLine } from './diff-model.ts';

/**
 * The identity of one file's diff, for matching it across heads (ADR 0064): the SHA-256 of its
 * changed lines in order (`+`/`-`, content and missing-newline flags), plus a mode change, plus
 * for a binary file its two blob names. Neither the path, line numbers, context lines, hunk
 * boundaries nor the commits behind the change take part, so the same edit keeps its identity
 * across a rebase that moves it, renames the file or changes the lines around it. Like
 * `git patch-id --stable` it is computed from the patch alone, but it keeps whitespace, which
 * a reviewer must see, and ignores context, which a rebase changes.
 */
export function fileDiffIdFrom(file: DiffFile): string {
  const hash = createHash('sha256');
  hash.update(`mode\0${modeChangeOf(file)}\n`);
  if (file.binary) {
    hash.update(`binary\0${file.oldObject ?? ''}\0${file.newObject ?? ''}\n`);
  }
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== 'context') {
        hash.update(hashedLine(line));
      }
    }
  }
  return hash.digest('hex');
}

function modeChangeOf(file: DiffFile): string {
  switch (file.status) {
    case 'added':
    case 'deleted': {
      return file.mode;
    }
    case 'modified': {
      if (file.oldMode === file.newMode) {
        return '';
      }
      return `${file.oldMode}>${file.newMode}`;
    }
    case 'renamed':
    case 'copied': {
      if (
        file.oldMode === undefined ||
        file.newMode === undefined ||
        file.oldMode === file.newMode
      ) {
        return '';
      }
      return `${file.oldMode}>${file.newMode}`;
    }
  }
}

/** A changed line as hashed: its sign, `!` when it lacks a final newline, and its content. */
function hashedLine(line: Exclude<DiffLine, { kind: 'context' }>): string {
  let sign = '-';
  if (line.kind === 'added') {
    sign = '+';
  }
  let mark = ' ';
  if (line.noNewline) {
    mark = '!';
  }
  return `${sign}${mark}${line.content}\n`;
}
